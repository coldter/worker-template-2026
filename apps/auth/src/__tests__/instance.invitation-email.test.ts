import { describe, expect, it, vi } from "vitest";

// Capture the second argument createOrganizationPlugin is called with so we
// can exercise the wired sendInvitationEmail callback in isolation. The
// plugin factory itself is tested upstream — we only assert that
// `createAuth` passes a non-no-op callback that drives the email transport.
type InvitationEmailCallback = (args: unknown) => Promise<void>;
const captured: { fn: InvitationEmailCallback | null } = { fn: null };

vi.mock("../plugins/organization-setup", () => ({
  createOrganizationPlugin: (
    _db: unknown,
    sendInvitationEmail?: InvitationEmailCallback
  ) => {
    captured.fn = sendInvitationEmail ?? null;
    return { id: "organization", endpoints: {}, schema: {} };
  },
}));

const sendEmailSpy = vi.fn(async () => ({ success: true }));
vi.mock("@repo/email", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/email")>("@repo/email");
  return {
    ...actual,
    sendEmail: (...args: unknown[]) => {
      // boundary: vi.fn loses tuple types; mock arg list is validated below.
      return sendEmailSpy(...(args as Parameters<typeof sendEmailSpy>));
    },
  };
});

vi.mock("pg", () => ({ default: {}, Client: class {}, Pool: class {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: () => ({}) }));

import type { AuthBindings } from "../instance";
import { createAuth } from "../instance";

const snapshot = {
  wildcardSuffix: ".app.example.com",
  adminHost: "admin.example.com",
  customHosts: [] as string[],
  localDevHosts: [] as string[],
};

const tenant = {
  organizationId: "org_acme",
  slug: "acme",
  host: "acme.app.example.com",
  kind: "subdomain" as const,
  enforceSSO: false,
  sessionVersion: 0,
  suspendedAt: null,
  deletedAt: null,
};

const env = {
  BETTER_AUTH_SECRET: "x".repeat(40),
  RESEND_API_KEY: "test_key",
  EMAIL_FROM: "noreply@example.com",
  APP_URL: "https://app.example.com",
  NODE_ENV: "test",
  // boundary: Worker bindings record — only the four scalars above are read by
  // the createAuth call path exercised here.
} as unknown as AuthBindings;

const ctxWaits: Promise<unknown>[] = [];
const ctx = {
  waitUntil: (p: Promise<unknown>) => {
    ctxWaits.push(p);
  },
  passThroughOnException: () => undefined,
};

describe("createAuth wires sendInvitationEmail through createOrganizationPlugin", () => {
  it("passes a callback to createOrganizationPlugin that triggers TenantInviteEmail", async () => {
    captured.fn = null;
    sendEmailSpy.mockClear();

    // boundary: the test stubs `pg` + drizzle; createAuth only reads structural
    // fields from db at construction time.
    createAuth({} as never, env, ctx, {
      tenant,
      allowedHostsSnapshot: snapshot,
    });

    const captured_fn = captured.fn;
    if (captured_fn === null) {
      throw new Error(
        "expected createOrganizationPlugin to receive a callback"
      );
    }
    // boundary: tsgo narrows the post-throw type to `never` when reading off
    // a mutable object property; re-bind through a typed local.
    const callback: InvitationEmailCallback = captured_fn;

    // Drive the wired callback with a synthetic invitation payload — this is
    // the shape BA's organization plugin invokes the callback with.
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await callback({
      id: "inv_1",
      role: "owner",
      email: "owner@acme.com",
      organization: { id: "org_acme", name: "Acme Co" },
      invitation: { id: "inv_1", expiresAt },
      inviter: {
        userId: "usr_op",
        organizationId: "org_acme",
        role: "owner",
        user: { id: "usr_op", name: "Operator", email: "op@example.com" },
      },
    });

    // The wired callback dispatches via ctx.waitUntil; await any pending
    // sends so the assertion is deterministic.
    await Promise.all(ctxWaits.splice(0));

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    const call = sendEmailSpy.mock.calls[0];
    if (!call) {
      throw new Error("expected sendEmail call");
    }
    // boundary: vi.fn arg type — sendEmail accepts a single options object.
    const [params] = call as unknown as [
      {
        to: string;
        subject: string;
        from: string;
        apiKey: string;
        props: { acceptUrl: string; organizationName: string };
      },
    ];
    expect(params.to).toBe("owner@acme.com");
    expect(params.subject).toContain("Acme Co");
    expect(params.apiKey).toBe("test_key");
    expect(params.props.acceptUrl).toBe(
      "https://acme.app.example.com/accept-invite/inv_1"
    );
    expect(params.props.organizationName).toBe("Acme Co");
  });
});
