import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { RegistryEvaluateOpts } from "../registry";
import { createAuthSchema, principalAttribute } from "../schema";
import type { Principal } from "../types";

describe("RegistryEvaluateOpts is shared by can and assertCan", () => {
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

  it("can() consults resolveRelation exactly once when supplied", async () => {
    const resolveRelation = vi.fn(async () => true);

    const decision = await registry.can(userPrincipal, "doc", "edit", {
      resource: { id: "doc_1", projectId: "proj_1" },
      resolveRelation,
    });

    expect(decision.allowed).toBe(true);
    expect(resolveRelation).toHaveBeenCalledTimes(1);
    expect(resolveRelation).toHaveBeenCalledWith(
      "user",
      "usr_1",
      "member",
      "project",
      "proj_1"
    );
  });

  it("can() denies when resolveRelation returns false", async () => {
    const resolveRelation = vi.fn(async () => false);

    const decision = await registry.can(userPrincipal, "doc", "edit", {
      resource: { id: "doc_1", projectId: "proj_1" },
      resolveRelation,
    });

    expect(decision.allowed).toBe(false);
    expect(resolveRelation).toHaveBeenCalledTimes(1);
  });

  it("both methods accept the same RegistryEvaluateOpts shape", () => {
    expectTypeOf(registry.can)
      .parameter(3)
      .toEqualTypeOf<RegistryEvaluateOpts | undefined>();
    expectTypeOf(registry.assertCan)
      .parameter(3)
      .toEqualTypeOf<RegistryEvaluateOpts | undefined>();
  });
});
