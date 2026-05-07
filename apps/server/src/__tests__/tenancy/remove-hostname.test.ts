/**
 * A5 audit fix tests for `customHostnameLifecycle.remove`:
 *  - service guard: enforce_sso=true + last active custom host -> 409
 *  - allowed when 2+ active customs and removing one
 *  - allowed when enforce_sso=false even with last active custom host
 *  - suspended/deleted orgs are exempt from the guard
 *  - reserved_slugs tombstone insert carries kind: "hostname"
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: async () => undefined,
}));
vi.mock("cloudflare:workers", () => ({
  env: {
    AUDIT_LOG_QUEUE: { send: async () => undefined },
  },
}));
vi.mock("@/modules/audit-logs/service", () => ({
  auditLogService: {
    create: vi.fn(async () => undefined),
    enqueue: vi.fn(() => undefined),
  },
}));
vi.mock("@/modules/tenancy/cf-api", () => ({
  createCustomHostname: vi.fn(),
  deleteCustomHostname: vi.fn(async () => undefined),
  getCustomHostname: vi.fn(),
}));

import {
  customHostnameLifecycle,
  type LifecycleEnv,
  TenancyConstraintError,
} from "@/modules/tenancy/lifecycle";

const ENV: LifecycleEnv = {
  CLOUDFLARE_API_TOKEN: "tok",
  CLOUDFLARE_ZONE_ID: "zone",
  CUSTOM_HOST_CNAME_TARGET: "customers.example.com",
  CUSTOM_HOST_VERIFICATION_LABEL: "_app-verify",
};

type Row = {
  id: string;
  organizationId: string;
  hostname: string;
  cfHostnameId: string | null;
  lifecycleStatus:
    | "pending_txt"
    | "awaiting_cf"
    | "pre_validation"
    | "active"
    | "failed"
    | "removing"
    | "removed";
};

type OrgRow = {
  enforceSSO: boolean;
  suspendedAt: Date | null;
  deletedAt: Date | null;
};

type SelectShape =
  | { kind: "row"; payload: Row[] }
  | { kind: "org"; payload: OrgRow[] }
  | { kind: "count"; payload: { n: number }[] };

type StubResult = {
  db: unknown;
  inserts: Record<string, unknown>[];
  updates: Partial<Row>[];
};

function makeStub(opts: {
  row: Row;
  org: OrgRow | null;
  activeCount: number;
}): StubResult {
  const inserts: Record<string, unknown>[] = [];
  const updates: Partial<Row>[] = [];
  const row: Row = { ...opts.row };
  let selectCallIndex = 0;
  // Order matches lifecycle.remove() select calls:
  //   1. select row by id
  //   2. (if active) select org enforceSSO/suspendedAt — via the
  //      `liveOrganizations(...)` seam, which filters out tombstoned rows
  //      (`WHERE deleted_at IS NULL`). The stub mirrors that filter: a
  //      deleted org is returned as an empty result so the guard skips.
  //   3. (if guard active) select count(*) active hosts
  const orgPayload: OrgRow[] = (() => {
    if (opts.org === null) {
      return [];
    }
    if (opts.org.deletedAt !== null) {
      return [];
    }
    return [opts.org];
  })();
  const planned: SelectShape[] = [
    { kind: "row", payload: [row] },
    { kind: "org", payload: orgPayload },
    { kind: "count", payload: [{ n: opts.activeCount }] },
  ];

  const buildSelectChain = () => {
    const idx = selectCallIndex;
    selectCallIndex += 1;
    const planEntry = planned[idx];
    const result = planEntry === undefined ? [] : planEntry.payload;
    return {
      from: () => ({
        where: () => Promise.resolve(result),
      }),
    };
  };

  const buildInsertChain = () => ({
    values: (v: Record<string, unknown>) => {
      inserts.push(v);
      return {
        onConflictDoNothing: () => Promise.resolve(),
        returning: () => Promise.resolve([{ id: "audit_x" }]),
      };
    },
  });

  const buildUpdateChain = () => ({
    set: (patch: Partial<Row>) => {
      updates.push(patch);
      Object.assign(row, patch);
      return {
        where: () => ({
          returning: () =>
            Promise.resolve([
              { id: row.id, lifecycleStatus: row.lifecycleStatus },
            ]),
        }),
      };
    },
  });

  const tx = {
    select: buildSelectChain,
    insert: buildInsertChain,
    update: buildUpdateChain,
  };

  const db = {
    select: buildSelectChain,
    update: buildUpdateChain,
    insert: buildInsertChain,
    transaction: async <T>(cb: (t: typeof tx) => Promise<T>): Promise<T> =>
      cb(tx),
  };

  return { db, inserts, updates };
}

const baseRow = (overrides: Partial<Row> = {}): Row => ({
  id: "tnh_1",
  organizationId: "org_1",
  hostname: "app.acme.test",
  cfHostnameId: null,
  lifecycleStatus: "active",
  ...overrides,
});

const actor = { id: "usr_1", organizationId: "org_1" };

describe("A5 remove() service guard (enforce_sso last access path)", () => {
  it("rejects when enforce_sso=true and the row is the last active custom hostname", async () => {
    const stub = makeStub({
      row: baseRow(),
      org: { enforceSSO: true, suspendedAt: null, deletedAt: null },
      activeCount: 1,
    });
    await expect(
      customHostnameLifecycle.remove(
        // boundary: hand-rolled stub mirrors the narrow drizzle surface used
        // by the lifecycle service.
        stub.db as unknown as Parameters<
          typeof customHostnameLifecycle.remove
        >[0],
        ENV,
        "tnh_1",
        actor
      )
    ).rejects.toBeInstanceOf(TenancyConstraintError);
    // No tombstone insert should have happened — guard fires before mutation.
    expect(stub.inserts).toHaveLength(0);
  });

  it("allows removal when enforce_sso=true and 2+ active custom hostnames exist", async () => {
    const stub = makeStub({
      row: baseRow(),
      org: { enforceSSO: true, suspendedAt: null, deletedAt: null },
      activeCount: 2,
    });
    const result = await customHostnameLifecycle.remove(
      stub.db as unknown as Parameters<
        typeof customHostnameLifecycle.remove
      >[0],
      ENV,
      "tnh_1",
      actor
    );
    expect(result.lifecycleStatus).toBe("removed");
    // Tombstone insert recorded with kind: "hostname".
    expect(stub.inserts).toHaveLength(1);
    expect(stub.inserts[0]).toMatchObject({
      slug: "app.acme.test",
      kind: "hostname",
      reason: "tombstoned",
    });
  });

  it("allows removal when enforce_sso=false even on the last active host", async () => {
    const stub = makeStub({
      row: baseRow(),
      org: { enforceSSO: false, suspendedAt: null, deletedAt: null },
      activeCount: 1,
    });
    const result = await customHostnameLifecycle.remove(
      stub.db as unknown as Parameters<
        typeof customHostnameLifecycle.remove
      >[0],
      ENV,
      "tnh_1",
      actor
    );
    expect(result.lifecycleStatus).toBe("removed");
    expect(stub.inserts).toHaveLength(1);
    expect(stub.inserts[0]).toMatchObject({ kind: "hostname" });
  });

  it("does NOT apply the guard for suspended orgs", async () => {
    const stub = makeStub({
      row: baseRow(),
      org: {
        enforceSSO: true,
        suspendedAt: new Date("2026-01-01T00:00:00Z"),
        deletedAt: null,
      },
      activeCount: 1,
    });
    const result = await customHostnameLifecycle.remove(
      stub.db as unknown as Parameters<
        typeof customHostnameLifecycle.remove
      >[0],
      ENV,
      "tnh_1",
      actor
    );
    expect(result.lifecycleStatus).toBe("removed");
  });

  it("does NOT apply the guard for deleted orgs", async () => {
    const stub = makeStub({
      row: baseRow(),
      org: {
        enforceSSO: true,
        suspendedAt: null,
        deletedAt: new Date("2026-01-01T00:00:00Z"),
      },
      activeCount: 1,
    });
    const result = await customHostnameLifecycle.remove(
      stub.db as unknown as Parameters<
        typeof customHostnameLifecycle.remove
      >[0],
      ENV,
      "tnh_1",
      actor
    );
    expect(result.lifecycleStatus).toBe("removed");
  });

  it("does NOT apply the guard when the row being removed is not currently active", async () => {
    // pending_txt rows aren't routable today, so they don't count toward
    // SSO access paths — guard skipped entirely.
    const stub = makeStub({
      row: baseRow({ lifecycleStatus: "pending_txt" }),
      org: { enforceSSO: true, suspendedAt: null, deletedAt: null },
      activeCount: 0,
    });
    const result = await customHostnameLifecycle.remove(
      stub.db as unknown as Parameters<
        typeof customHostnameLifecycle.remove
      >[0],
      ENV,
      "tnh_1",
      actor
    );
    expect(result.lifecycleStatus).toBe("removed");
  });
});
