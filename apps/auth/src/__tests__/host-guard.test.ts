import { describe, expect, it } from "vitest";
import { type AllowedHostsSnapshot, isHostAllowed } from "../host-config";

const snapshot: AllowedHostsSnapshot = Object.freeze({
  wildcardSuffix: ".app.example.com",
  adminHost: "admin.example.com",
  customHosts: Object.freeze(["acme.example.io"]),
  localDevHosts: Object.freeze(["localhost:8788"]),
});

describe("D29 auth host-header guard (isHostAllowed)", () => {
  it("admits an apex host", () => {
    expect(isHostAllowed("app.example.com", snapshot)).toBe(true);
  });

  it("admits a wildcard tenant host", () => {
    expect(isHostAllowed("acme.app.example.com", snapshot)).toBe(true);
  });

  it("admits an active custom hostname", () => {
    expect(isHostAllowed("acme.example.io", snapshot)).toBe(true);
  });

  it("admits a configured local-dev host with port", () => {
    expect(isHostAllowed("localhost:8788", snapshot)).toBe(true);
  });

  it("rejects the admin host (excluded from allow-list)", () => {
    expect(isHostAllowed("admin.example.com", snapshot)).toBe(false);
  });

  it("rejects an unrelated host (workers.dev probe)", () => {
    expect(isHostAllowed("auth.example.workers.dev", snapshot)).toBe(false);
  });

  it("rejects a nested subdomain under the wildcard suffix", () => {
    expect(isHostAllowed("nested.acme.app.example.com", snapshot)).toBe(false);
  });

  it("rejects an empty host", () => {
    expect(isHostAllowed("", snapshot)).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(isHostAllowed("ACME.APP.EXAMPLE.COM", snapshot)).toBe(true);
  });
});
