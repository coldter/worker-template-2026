import { describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "../errors";
import { createAuthSchema, principalAttribute } from "../schema";
import type { Principal } from "../types";

describe("assertCan forwards resolveRelation", () => {
  const auth = createAuthSchema({
    roles: ["admin", "user"],
    systemAdminRoles: ["admin"],
    relations: ["member"],
    principal: {
      status: principalAttribute<string>(),
    },
    globalPolicies: () => [],
  });

  interface Doc {
    id: string;
    projectId: string;
  }

  const docResource = auth.createResource<Doc>("doc", {
    actions: ["edit"],
    policies: (p) => [
      p.allow("user").to("edit").withRelation("member", "project"),
    ],
    relations: {
      project: (resource: Doc) => resource.projectId,
    },
  });

  const registry = auth.buildRegistry({ doc: docResource });

  const userPrincipal: Principal = {
    id: "usr_1",
    roles: ["user"],
    attributes: { status: "active" },
  };

  it("assertCan consults resolveRelation and allows when it returns true", async () => {
    const resolveRelation = vi.fn(async () => true);

    await expect(
      registry.assertCan(userPrincipal, "doc", "edit", {
        resource: { id: "doc_1", projectId: "proj_1" },
        resolveRelation,
      })
    ).resolves.toBeUndefined();

    expect(resolveRelation).toHaveBeenCalledTimes(1);
    expect(resolveRelation).toHaveBeenCalledWith(
      "user",
      "usr_1",
      "member",
      "project",
      "proj_1"
    );
  });

  it("assertCan throws AuthorizationError when resolveRelation returns false", async () => {
    const resolveRelation = vi.fn(async () => false);

    await expect(
      registry.assertCan(userPrincipal, "doc", "edit", {
        resource: { id: "doc_1", projectId: "proj_1" },
        resolveRelation,
      })
    ).rejects.toThrow(AuthorizationError);

    expect(resolveRelation).toHaveBeenCalledTimes(1);
  });
});
