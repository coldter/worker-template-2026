import { describe, expect, it } from "vitest";
import { authorization, buildAuthorizationPrincipal } from "../authorization";

// Notifications must be ownership-gated. The resource declares
// `resolveOwner: (r) => r.userId`; the per-row policy uses `whereOwner()` so
// `view` and `mark-read` only succeed when the calling principal owns the
// notification row. Without these guards `p.allow("user").to(...)` would let
// any authenticated user act on another user's notifications.
describe("notification authorization", () => {
  const owner = buildAuthorizationPrincipal({
    id: "usr_1",
    roleSlugs: ["user"],
    status: "active",
  });
  const stranger = buildAuthorizationPrincipal({
    id: "usr_2",
    roleSlugs: ["user"],
    status: "active",
  });

  it("allows the owner to view their notification", async () => {
    const decision = await authorization.can(owner, "notification", "view", {
      resource: { userId: "usr_1" },
    });
    expect(decision.allowed).toBe(true);
  });

  it("denies a stranger trying to view another user's notification", async () => {
    const decision = await authorization.can(stranger, "notification", "view", {
      resource: { userId: "usr_1" },
    });
    expect(decision.allowed).toBe(false);
  });

  it("allows the owner to mark-read their notification", async () => {
    const decision = await authorization.can(
      owner,
      "notification",
      "mark-read",
      { resource: { userId: "usr_1" } }
    );
    expect(decision.allowed).toBe(true);
  });

  it("denies a stranger trying to mark-read another user's notification", async () => {
    const decision = await authorization.can(
      stranger,
      "notification",
      "mark-read",
      { resource: { userId: "usr_1" } }
    );
    expect(decision.allowed).toBe(false);
  });

  it("collection-level list still works for any authenticated user", async () => {
    const decision = await authorization.can(stranger, "notification", "list");
    expect(decision.allowed).toBe(true);
  });
});
