// A7.2 — drift checker contract. Generates against the baseline fixture,
// then asserts (a) clean tree → ok, (b) tampered fragment → mismatch entry,
// (c) deleted SAN list → missing entry.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheckHosts } from "../check-hosts";
import { BASELINE_FIXTURE } from "../lib/__tests__/host-config.fixture";
import { runSetupEnv } from "../setup-env";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "check-hosts-test-"));
  await runSetupEnv({ fixture: BASELINE_FIXTURE, outDir: tmpDir });
});

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("runCheckHosts", () => {
  test("clean tree → ok", async () => {
    const result = await runCheckHosts({
      rootDir: tmpDir,
      fixture: BASELINE_FIXTURE,
    });
    expect(result.ok).toBe(true);
    expect(result.drift).toHaveLength(0);
  });

  test("tampered wrangler fragment → mismatch entry", async () => {
    const fragmentPath = join(
      tmpDir,
      "apps/server/wrangler.jsonc.fragment.json"
    );
    const original = readFileSync(fragmentPath, "utf8");
    const tampered = original.replace(".app.lvh.me", "tampered.example.com");
    writeFileSync(fragmentPath, tampered, "utf8");

    const result = await runCheckHosts({
      rootDir: tmpDir,
      fixture: BASELINE_FIXTURE,
    });
    expect(result.ok).toBe(false);
    const mismatch = result.drift.find(
      (d) => d.path === "apps/server/wrangler.jsonc.fragment.json"
    );
    expect(mismatch).toBeDefined();
    expect(mismatch?.reason).toBe("mismatch");
  });

  test("deleted mkcert sans → missing entry", async () => {
    unlinkSync(join(tmpDir, "local-harness/mkcert-sans.txt"));
    const result = await runCheckHosts({
      rootDir: tmpDir,
      fixture: BASELINE_FIXTURE,
    });
    expect(result.ok).toBe(false);
    const missing = result.drift.find(
      (d) => d.path === "local-harness/mkcert-sans.txt"
    );
    expect(missing).toBeDefined();
    expect(missing?.reason).toBe("missing");
  });

  test("wrangler.jsonc with mismatched vars → wrangler-vars-parity entry", async () => {
    // Seed a minimal wrangler.jsonc whose vars block disagrees with the
    // fragment, then assert the drift checker flags the parity issue.
    const wranglerDir = join(tmpDir, "apps/server");
    mkdirSync(wranglerDir, { recursive: true });
    const wranglerPath = join(wranglerDir, "wrangler.jsonc");
    writeFileSync(
      wranglerPath,
      `{
  "name": "server",
  "vars": {
    "WILDCARD_SUFFIX": ".tampered.example.com",
    "ADMIN_HOST": "admin.lvh.me"
  }
}
`,
      "utf8"
    );
    const result = await runCheckHosts({
      rootDir: tmpDir,
      fixture: BASELINE_FIXTURE,
    });
    expect(result.ok).toBe(false);
    const parity = result.drift.find(
      (d) =>
        d.path === "apps/server/wrangler.jsonc" &&
        d.reason === "wrangler-vars-parity"
    );
    expect(parity).toBeDefined();
    expect(parity?.detail).toContain("WILDCARD_SUFFIX");
  });
});
