import { describe, expect, it, vi } from "vitest";
import { logger, REDACT_KEYS, redact } from "../logger";

describe("redact()", () => {
  it("returns primitives unchanged", () => {
    expect(redact("hello")).toBe("hello");
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });

  it("redacts top-level sensitive keys", () => {
    expect(redact({ password: "p", ok: "ok" })).toEqual({
      password: "[REDACTED]",
      ok: "ok",
    });
  });

  it("redacts nested objects recursively", () => {
    const out = redact({
      level1: {
        level2: {
          clientSecret: "shh",
          safe: "ok",
        },
      },
    });
    expect(out).toEqual({
      level1: {
        level2: {
          clientSecret: "[REDACTED]",
          safe: "ok",
        },
      },
    });
  });

  it("redacts secrets inside arrays", () => {
    const out = redact([{ secret: "s1" }, { ok: "v", api_key: "k" }]);
    expect(out).toEqual([
      { secret: "[REDACTED]" },
      { ok: "v", api_key: "[REDACTED]" },
    ]);
  });

  it("matches keys case-insensitively across camelCase and snake_case", () => {
    const out = redact({
      Secret: "a",
      ClientSecret: "b",
      CLIENT_SECRET: "c",
      Authorization: "d",
      EnrollmentToken: "e",
      ENROLLMENT_TOKEN: "f",
    });
    expect(out).toEqual({
      Secret: "[REDACTED]",
      ClientSecret: "[REDACTED]",
      CLIENT_SECRET: "[REDACTED]",
      Authorization: "[REDACTED]",
      EnrollmentToken: "[REDACTED]",
      ENROLLMENT_TOKEN: "[REDACTED]",
    });
  });

  it("does not redact non-sensitive keys", () => {
    const out = redact({ id: "u_1", email: "a@b.com" });
    expect(out).toEqual({ id: "u_1", email: "a@b.com" });
  });

  it("respects extraKeys for callsite-specific redaction", () => {
    const out = redact(
      { ssn: "123-45-6789", id: "u_1" },
      { extraKeys: new Set(["ssn"]) }
    );
    expect(out).toEqual({ ssn: "[REDACTED]", id: "u_1" });
  });

  it("extraKeys also match case-insensitively", () => {
    const out = redact(
      { SSN: "x", Pin: "y", id: "u_1" },
      { extraKeys: new Set(["ssn", "pin"]) }
    );
    expect(out).toEqual({
      SSN: "[REDACTED]",
      Pin: "[REDACTED]",
      id: "u_1",
    });
  });

  it("stops descending past depthCap and returns the deeper value as-is", () => {
    // Build a 5-deep nested object with a secret at the bottom; cap at 2.
    const leaf = { secret: "deep" };
    const nested = {
      a: { b: { c: { d: leaf } } },
    };
    const out = redact(nested, { depthCap: 2 }) as {
      a: { b: { c: { d: { secret: string } } } };
    };
    // At depth 0 -> 1 -> 2 we still walk; depth 3+ returns as-is.
    // Because the recursion depth is incremented per-level, the leaf is
    // returned untouched once we exceed the cap.
    expect(out.a.b.c.d.secret).toBe("deep");
  });

  it("redacts all keys present in REDACT_KEYS", () => {
    const input: Record<string, string> = {};
    for (const k of REDACT_KEYS) {
      input[k] = "x";
    }
    const out = redact(input) as Record<string, string>;
    for (const k of REDACT_KEYS) {
      expect(out[k]).toBe("[REDACTED]");
    }
  });

  it("preserves the original input (does not mutate)", () => {
    const input = { password: "p", id: "u_1" };
    const before = { ...input };
    redact(input);
    expect(input).toEqual(before);
  });
});

describe("logger routes context through redact()", () => {
  it("redacts the context payload before emitting", () => {
    const lines: unknown[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => {
      lines.push(line);
    });
    try {
      logger.info("test", { secret: "topsecret-abc", id: "u_1" });
    } finally {
      spy.mockRestore();
    }
    const haystack = lines
      .map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
      .join("\n");
    expect(haystack).not.toContain("topsecret-abc");
    expect(haystack).toContain("[REDACTED]");
    expect(haystack).toContain("u_1");
  });
});
