import { describe, expect, it } from "vitest";

import { alpha2ToNumeric } from "@/utils/country-codes";

describe(alpha2ToNumeric, () => {
  it.each([
    ["US", "0840"],
    ["CA", "0124"],
    ["GB", "0826"],
    ["IN", "0356"],
    ["AU", "0036"],
    ["JP", "0392"],
    ["DE", "0276"],
    ["FR", "0250"],
    ["MX", "0484"],
  ])("converts %s to %s", (alpha2, expected) => {
    expect(alpha2ToNumeric(alpha2)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(alpha2ToNumeric("us")).toBe("0840");
    expect(alpha2ToNumeric("Us")).toBe("0840");
  });

  it("returns input unchanged for unknown codes", () => {
    expect(alpha2ToNumeric("XX")).toBe("XX");
    expect(alpha2ToNumeric("ZZ")).toBe("ZZ");
  });
});
