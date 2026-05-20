import { describe, expect, it } from "vitest";
import { ID_PREFIXES, idFor } from "../src/ids";

// Hoisted to satisfy `lint/performance/useTopLevelRegex`.
const HEX_BODY = /^[0-9a-f]+$/;

describe("idFor", () => {
  it("returns a prefixed CUID for notificationPreference using the registry prefix", () => {
    const id = idFor("notificationPreference");
    expect(id.startsWith("ntfp_")).toBe(true);
    expect(id.startsWith(`${ID_PREFIXES.notificationPreference}_`)).toBe(true);
  });

  it("returns a prefixed CUID for jwk using the registry prefix", () => {
    const id = idFor("jwk");
    expect(id.startsWith("jwk_")).toBe(true);
    expect(id.startsWith(`${ID_PREFIXES.jwk}_`)).toBe(true);
  });

  it("returns a prefixed CUID for twoFactor using the registry prefix", () => {
    const id = idFor("twoFactor");
    expect(id.startsWith("2fa_")).toBe(true);
    expect(id.startsWith(`${ID_PREFIXES.twoFactor}_`)).toBe(true);
  });

  it("produces ids interchangeable with the previous raw-string callsite format", () => {
    const id = idFor("notificationPreference");
    const [prefix, body] = id.split("_");
    expect(prefix).toBe("ntfp");
    expect(body).toMatch(HEX_BODY);
    // 4-byte timestamp (8 hex) + 8-byte random (16 hex).
    expect(body.length).toBeGreaterThanOrEqual(8 + 16);
  });
});
