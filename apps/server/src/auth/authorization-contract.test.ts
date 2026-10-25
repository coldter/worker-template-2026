import {
  authorization,
  buildAuthorizationPrincipal,
} from "@repo/shared/authorization";
import { describe, expect, it } from "vitest";

describe("shared authorization contract", () => {
  it("admin capabilities stay aligned with the registry", async () => {
    const principal = buildAuthorizationPrincipal({
      id: "usr_admin",
      roleSlugs: ["admin"],
      status: "active",
    });

    const capabilities = await authorization.evaluateCapabilities(principal);

    expect(capabilities).toMatchObject({
      "audit-log:list": true,
      "notification:get-unread-count": true,
      "notification:list": true,
      "role:list": true,
      "user:activate": true,
      "user:assign-roles": true,
      "user:create": true,
      "user:deactivate": true,
      "user:delete": true,
      "user:list": true,
      "user:unlock": true,
      "user:update": true,
      "user:view": true,
    });
  });

  it("user capabilities stay limited to owned resources", async () => {
    const principal = buildAuthorizationPrincipal({
      id: "usr_user",
      roleSlugs: ["user"],
      status: "active",
    });

    const capabilities = await authorization.evaluateCapabilities(principal);

    expect(capabilities).toMatchObject({
      "audit-log:list": false,
      "notification:get-unread-count": true,
      "notification:list": true,
      "role:list": true,
      "user:activate": false,
      "user:assign-roles": false,
      "user:create": false,
      "user:deactivate": false,
      "user:delete": false,
      "user:list": false,
      "user:unlock": false,
      "user:update": true,
      "user:view": true,
    });
  });
});
