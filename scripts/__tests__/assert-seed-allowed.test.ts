import { describe, expect, test } from "bun:test";
import { assertSeedAllowed } from "../lib/assert-seed-allowed";

const LOCAL = "postgresql://postgres:postgres@localhost:5432/app_dev";
const LOCAL_127 = "postgresql://postgres:postgres@127.0.0.1:5432/app_dev";
const LOCAL_DOCKER =
  "postgresql://postgres:postgres@host.docker.internal:5432/app_dev";
const LOCAL_MDNS = "postgresql://postgres:postgres@db.local:5432/app_dev";
const REMOTE = "postgresql://user:pw@db.prod.example.com:5432/app";

describe("assertSeedAllowed", () => {
  test("allows NODE_ENV=development with localhost connection string", () => {
    const r = assertSeedAllowed({
      nodeEnv: "development",
      argv: [],
      connectionString: LOCAL,
    });
    expect(r.ok).toBe(true);
  });

  test("allows NODE_ENV=test with localhost connection string", () => {
    const r = assertSeedAllowed({
      nodeEnv: "test",
      argv: [],
      connectionString: LOCAL,
    });
    expect(r.ok).toBe(true);
  });

  test("allows 127.0.0.1 connection strings", () => {
    const r = assertSeedAllowed({
      nodeEnv: "development",
      argv: [],
      connectionString: LOCAL_127,
    });
    expect(r.ok).toBe(true);
  });

  test("allows host.docker.internal connection strings", () => {
    const r = assertSeedAllowed({
      nodeEnv: "development",
      argv: [],
      connectionString: LOCAL_DOCKER,
    });
    expect(r.ok).toBe(true);
  });

  test("allows .local connection strings", () => {
    const r = assertSeedAllowed({
      nodeEnv: "development",
      argv: [],
      connectionString: LOCAL_MDNS,
    });
    expect(r.ok).toBe(true);
  });

  test("refuses production NODE_ENV by default", () => {
    const r = assertSeedAllowed({
      nodeEnv: "production",
      argv: [],
      connectionString: LOCAL,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("production");
    }
  });

  test("refuses missing NODE_ENV by default", () => {
    const r = assertSeedAllowed({
      nodeEnv: undefined,
      argv: [],
      connectionString: LOCAL,
    });
    expect(r.ok).toBe(false);
  });

  test("refuses non-local connection string even in development", () => {
    const r = assertSeedAllowed({
      nodeEnv: "development",
      argv: [],
      connectionString: REMOTE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("non-local");
    }
  });

  test("refuses missing connection string", () => {
    const r = assertSeedAllowed({
      nodeEnv: "development",
      argv: [],
      connectionString: undefined,
    });
    expect(r.ok).toBe(false);
  });

  test("refuses empty connection string", () => {
    const r = assertSeedAllowed({
      nodeEnv: "development",
      argv: [],
      connectionString: "",
    });
    expect(r.ok).toBe(false);
  });

  test("--allow-non-dev permits non-development NODE_ENV but still requires local conn string", () => {
    const r = assertSeedAllowed({
      nodeEnv: "production",
      argv: ["--allow-non-dev"],
      connectionString: LOCAL,
    });
    expect(r.ok).toBe(true);
  });

  test("--allow-non-dev does NOT bypass the non-local connection check", () => {
    const r = assertSeedAllowed({
      nodeEnv: "production",
      argv: ["--allow-non-dev"],
      connectionString: REMOTE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("non-local");
    }
  });
});
