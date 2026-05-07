import { describe, expect, it, vi } from "vitest";

const DUPLICATE_KEY_RE = /duplicate key/;

vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));

vi.mock("@/modules/audit-logs/service", () => ({
  auditLogService: {
    create: vi.fn(async (input: unknown) => input),
    enqueue: vi.fn(() => undefined),
    createDualScope: vi.fn(async () => ({ globalRow: {}, tenantRow: {} })),
  },
}));

import type { Executor } from "@repo/db";
import {
  createTenantOnBehalfOf,
  type SendInviteEmailHook,
} from "@/lib/tenants/create-tenant";
import { SlugReservedError, SlugTakenError } from "@/lib/tenants/errors";
import { auditLogService } from "@/modules/audit-logs/service";

type Insert = {
  index: number;
  values: Record<string, unknown>;
};

type FakeDbOptions = {
  failOnSecondInsert?: boolean;
  reservedRows?: Array<{ slug: string }>;
  // When set, the first insert throws an error mimicking the pg unique-violation
  // shape (SQLSTATE 23505) on the organization slug constraint.
  pgUniqueViolationOnFirstInsert?: {
    constraint?: string;
  };
};

function makeFakeDb(opts: FakeDbOptions = {}) {
  const inserts: Insert[] = [];
  const reservedRows = opts.reservedRows ?? [];
  let insertCount = 0;
  const tx: {
    insert: (table: unknown) => unknown;
    select: (columns?: unknown) => unknown;
  } = {
    insert(_table: unknown) {
      const index = insertCount;
      insertCount += 1;
      return {
        values: async (values: Record<string, unknown>) => {
          if (index === 0 && opts.pgUniqueViolationOnFirstInsert) {
            const e = new Error(
              "duplicate key value violates unique constraint"
            ) as Error & { code?: string; constraint?: string };
            e.code = "23505";
            if (opts.pgUniqueViolationOnFirstInsert.constraint) {
              e.constraint = opts.pgUniqueViolationOnFirstInsert.constraint;
            }
            throw e;
          }
          if (opts.failOnSecondInsert && index === 1) {
            throw new Error("duplicate key value violates unique constraint");
          }
          inserts.push({ index, values });
        },
      };
    },
    select(_columns?: unknown) {
      return {
        from(_table: unknown) {
          return {
            where(_predicate: unknown) {
              return {
                limit: async (_n: number) => reservedRows,
              };
            },
          };
        },
      };
    },
  };

  return {
    inserts,
    db: {
      transaction: async <T>(cb: (tx: Executor) => Promise<T>): Promise<T> => {
        // boundary: tests inject a partial drizzle stub matching only the
        // narrow .insert(...).values(...) and .select(...).from(...).where(...)
        // surface used by the lib.
        return cb(tx as unknown as Executor);
      },
    },
  };
}

describe("createTenantOnBehalfOf", () => {
  it("inserts org + invitation and writes a CRITICAL dual-scope tenant.created audit", async () => {
    vi.mocked(auditLogService.createDualScope).mockClear();
    const { db, inserts } = makeFakeDb();

    const result = await createTenantOnBehalfOf(
      // boundary: tests inject a partial drizzle stub; lib only reads
      // db.transaction.
      {
        actor: { kind: "global_admin", globalAdminId: "gad_op" },
        db: db as never,
      },
      { slug: "acme", name: "Acme Co", primaryAdminEmail: "ADMIN@Acme.com" }
    );

    expect(result.orgId.startsWith("org_")).toBe(true);
    expect(result.invitationId.startsWith("inv_")).toBe(true);

    expect(inserts).toHaveLength(2);
    const [orgInsert, inviteInsert] = inserts;
    if (!(orgInsert && inviteInsert)) {
      throw new Error("expected both inserts");
    }
    expect(orgInsert.values.slug).toBe("acme");
    expect(orgInsert.values.name).toBe("Acme Co");
    expect(orgInsert.values.id).toBe(result.orgId);
    expect(inviteInsert.values.email).toBe("admin@acme.com");
    expect(inviteInsert.values.inviterId).toBeNull();
    expect(inviteInsert.values.role).toBe("owner");
    expect(inviteInsert.values.status).toBe("pending");
    expect(inviteInsert.values.organizationId).toBe(result.orgId);

    expect(auditLogService.createDualScope).toHaveBeenCalledTimes(1);
    const call = vi.mocked(auditLogService.createDualScope).mock.calls[0];
    if (!call) {
      throw new Error("expected createDualScope call");
    }
    const [auditInput] = call;
    expect(auditInput.event).toBe("tenant.created");
    expect(auditInput.actorType).toBe("global_admin");
    expect(auditInput.actorId).toBe("gad_op");
    expect(auditInput.organizationId).toBe(result.orgId);
    expect(auditInput.targetType).toBe("tenant");
    expect(auditInput.targetId).toBe(result.orgId);
  });

  it("rolls back when the invitation insert fails (single transaction)", async () => {
    vi.mocked(auditLogService.createDualScope).mockClear();
    const { db, inserts } = makeFakeDb({ failOnSecondInsert: true });

    await expect(
      createTenantOnBehalfOf(
        {
          actor: { kind: "global_admin", globalAdminId: "gad_op" },
          db: db as never,
          forceInvitationId: "inv_dup",
        },
        { slug: "globex", name: "Globex", primaryAdminEmail: "x@y.com" }
      )
    ).rejects.toThrow(DUPLICATE_KEY_RE);

    // Only the first insert (org) was attempted; audit was never reached.
    expect(inserts).toHaveLength(1);
    expect(auditLogService.createDualScope).not.toHaveBeenCalled();
  });

  it("throws SlugReservedError when the slug is in reserved_slugs (kind = 'slug')", async () => {
    vi.mocked(auditLogService.createDualScope).mockClear();
    const { db, inserts } = makeFakeDb({
      reservedRows: [{ slug: "admin" }],
    });

    let caught: unknown;
    try {
      await createTenantOnBehalfOf(
        {
          actor: { kind: "global_admin", globalAdminId: "gad_op" },
          db: db as never,
        },
        { slug: "admin", name: "Admin Co", primaryAdminEmail: "x@y.com" }
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SlugReservedError);
    if (caught instanceof SlugReservedError) {
      expect(caught.code).toBe("SLUG_RESERVED");
      expect(caught.slug).toBe("admin");
    }
    // Reserved-slug guard runs before any insert and audit.
    expect(inserts).toHaveLength(0);
    expect(auditLogService.createDualScope).not.toHaveBeenCalled();
  });

  it("throws SlugTakenError on a Postgres unique-violation against organization_slug_key", async () => {
    vi.mocked(auditLogService.createDualScope).mockClear();
    const { db, inserts } = makeFakeDb({
      pgUniqueViolationOnFirstInsert: {
        constraint: "organization_slug_key",
      },
    });

    let caught: unknown;
    try {
      await createTenantOnBehalfOf(
        {
          actor: { kind: "global_admin", globalAdminId: "gad_op" },
          db: db as never,
        },
        { slug: "acme", name: "Acme Co", primaryAdminEmail: "x@y.com" }
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SlugTakenError);
    if (caught instanceof SlugTakenError) {
      expect(caught.code).toBe("SLUG_TAKEN");
      expect(caught.slug).toBe("acme");
    }
    // No row was persisted and audit was never reached.
    expect(inserts).toHaveLength(0);
    expect(auditLogService.createDualScope).not.toHaveBeenCalled();
  });

  it("dispatches the post-commit invite email with the resolved invitation id + email", async () => {
    vi.mocked(auditLogService.createDualScope).mockClear();
    const { db } = makeFakeDb();
    const sendInviteEmail = vi.fn<SendInviteEmailHook>(async () => undefined);
    const waitUntil = vi.fn((_p: Promise<unknown>) => undefined);

    const result = await createTenantOnBehalfOf(
      {
        actor: { kind: "global_admin", globalAdminId: "gad_op" },
        db: db as never,
        sendInviteEmail,
        waitUntil,
      },
      { slug: "acme", name: "Acme Co", primaryAdminEmail: "ADMIN@Acme.com" }
    );

    expect(sendInviteEmail).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    const call = sendInviteEmail.mock.calls[0]?.[0];
    expect(call?.invitationId).toBe(result.invitationId);
    expect(call?.organizationId).toBe(result.orgId);
    expect(call?.slug).toBe("acme");
    expect(call?.organizationName).toBe("Acme Co");
    expect(call?.email).toBe("admin@acme.com");
    // 48h default expiry.
    expect(call?.expiresInHours).toBe(48);
  });

  it("does not dispatch the invite email when the transaction rolls back", async () => {
    vi.mocked(auditLogService.createDualScope).mockClear();
    const { db } = makeFakeDb({ failOnSecondInsert: true });
    const sendInviteEmail = vi.fn<SendInviteEmailHook>(async () => undefined);

    await expect(
      createTenantOnBehalfOf(
        {
          actor: { kind: "global_admin", globalAdminId: "gad_op" },
          db: db as never,
          forceInvitationId: "inv_dup",
          sendInviteEmail,
        },
        { slug: "globex", name: "Globex", primaryAdminEmail: "x@y.com" }
      )
    ).rejects.toThrow(DUPLICATE_KEY_RE);

    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it("throws SlugTakenError on a bare 23505 (no constraint name) — driver fallback", async () => {
    vi.mocked(auditLogService.createDualScope).mockClear();
    const { db } = makeFakeDb({
      pgUniqueViolationOnFirstInsert: {},
    });

    await expect(
      createTenantOnBehalfOf(
        {
          actor: { kind: "global_admin", globalAdminId: "gad_op" },
          db: db as never,
        },
        { slug: "globex", name: "Globex", primaryAdminEmail: "x@y.com" }
      )
    ).rejects.toBeInstanceOf(SlugTakenError);
  });
});
