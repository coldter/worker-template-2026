import { describe, expect, it } from "vitest";
import {
  type AllowedHostsSnapshot,
  deriveAllowedHosts,
  excludeAdminHost,
  expandWildcardHosts,
} from "../host-config";

const baseSnapshot: AllowedHostsSnapshot = {
  wildcardSuffix: ".app.example.com",
  adminHost: "admin.example.com",
  customHosts: ["acme.example.io"],
  localDevHosts: ["localhost:3000"],
};

describe("expandWildcardHosts", () => {
  it("returns apex suffix, wildcard pattern, and custom hosts", () => {
    const result = expandWildcardHosts(baseSnapshot);
    expect(result).toContain("app.example.com");
    expect(result).toContain("*.app.example.com");
    expect(result).toContain("acme.example.io");
  });

  it("does not include localDevHosts", () => {
    const result = expandWildcardHosts(baseSnapshot);
    expect(result).not.toContain("localhost:3000");
  });
});

describe("excludeAdminHost", () => {
  it("removes the admin host from the list", () => {
    const hosts = ["app.example.com", "admin.example.com", "acme.example.io"];
    const result = excludeAdminHost(hosts, "admin.example.com");
    expect(result).not.toContain("admin.example.com");
    expect(result).toContain("app.example.com");
  });

  it("is a no-op when admin host is not present", () => {
    const hosts = ["app.example.com", "acme.example.io"];
    const result = excludeAdminHost(hosts, "admin.example.com");
    expect(result).toEqual(hosts);
  });
});

describe("deriveAllowedHosts", () => {
  it("returns wildcard-expanded hosts excluding admin", () => {
    const result = deriveAllowedHosts(baseSnapshot);
    expect(result).toContain("app.example.com");
    expect(result).toContain("*.app.example.com");
    expect(result).toContain("acme.example.io");
    expect(result).not.toContain("admin.example.com");
  });

  it("throws when wildcardSuffix collides with adminHost", () => {
    const colliding: AllowedHostsSnapshot = {
      ...baseSnapshot,
      wildcardSuffix: ".admin.example.com",
      adminHost: "admin.example.com",
    };
    expect(() => deriveAllowedHosts(colliding)).toThrow();
  });
});
