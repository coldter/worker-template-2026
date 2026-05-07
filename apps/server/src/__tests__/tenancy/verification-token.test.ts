import { describe, expect, it } from "vitest";
import { generateVerificationToken } from "@/modules/tenancy/verification-token";

describe("A5 generateVerificationToken", () => {
  it("returns a string with the vtok_ prefix", () => {
    const t = generateVerificationToken();
    expect(t.startsWith("vtok_")).toBe(true);
  });

  it("returns unique tokens across many calls", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateVerificationToken());
    }
    expect(tokens.size).toBe(100);
  });
});
