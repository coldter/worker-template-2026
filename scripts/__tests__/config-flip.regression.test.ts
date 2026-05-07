// A7.11 — config-flip regression. Generate artifacts against two fixtures
// (baseline `example.com` + flipped `mycoolsaas.dev`) and assert every
// derived value changed. If any artifact still contains a baseline value
// after the flip, the renderer has a hard-coded literal — the test fails
// with a structured diff naming the path.

import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  BASELINE_FIXTURE,
  FLIPPED_FIXTURE,
} from "../lib/__tests__/host-config.fixture";
import {
  deriveHostConfig,
  findHardcodedHosts,
  renderAllArtifacts,
} from "../lib/host-config";
import { runSetupEnv } from "../setup-env";

function listFiles(root: string, dir: string = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listFiles(root, full));
    } else {
      out.push(relative(root, full));
    }
  }
  return out;
}

describe("config-flip regression", () => {
  test("every artifact differs between baseline and flipped fixtures", async () => {
    const tmpA = mkdtempSync(join(tmpdir(), "config-flip-A-"));
    const tmpB = mkdtempSync(join(tmpdir(), "config-flip-B-"));
    try {
      await runSetupEnv({ fixture: BASELINE_FIXTURE, outDir: tmpA });
      await runSetupEnv({ fixture: FLIPPED_FIXTURE, outDir: tmpB });

      const filesA = listFiles(tmpA).sort();
      const filesB = listFiles(tmpB).sort();
      expect(filesB).toEqual(filesA);

      // `.dev.vars.tenancy` only carries dev-tenant gate flags (constants,
      // not host-derived) — those are expected to stay the same.
      const hostDerived = filesA.filter(
        (rel) => !rel.endsWith(".dev.vars.tenancy")
      );
      const unchanged: string[] = [];
      for (const rel of hostDerived) {
        const a = readFileSync(join(tmpA, rel), "utf8");
        const b = readFileSync(join(tmpB, rel), "utf8");
        if (a === b) {
          unchanged.push(rel);
        }
      }
      expect(
        unchanged,
        `unchanged after flip: ${unchanged.join(", ")}`
      ).toEqual([]);
    } finally {
      rmSync(tmpA, { recursive: true, force: true });
      rmSync(tmpB, { recursive: true, force: true });
    }
  });

  test("findHardcodedHosts catches a baseline value leaking into a flipped render", () => {
    const flippedCfg = deriveHostConfig(FLIPPED_FIXTURE);
    const flippedArtifacts = renderAllArtifacts(flippedCfg);
    const leaks = findHardcodedHosts(
      flippedArtifacts,
      BASELINE_FIXTURE,
      FLIPPED_FIXTURE
    );
    expect(leaks).toEqual([]);
  });

  test("findHardcodedHosts fires when a synthetic artifact carries a baseline literal", () => {
    const synthetic = [
      {
        path: "apps/server/wrangler.jsonc.fragment.json",
        content: 'WILDCARD_SUFFIX="app.example.com"\n',
      },
    ];
    const leaks = findHardcodedHosts(
      synthetic,
      BASELINE_FIXTURE,
      FLIPPED_FIXTURE
    );
    expect(leaks.length).toBeGreaterThan(0);
    const first = leaks[0];
    expect(first?.path).toBe("apps/server/wrangler.jsonc.fragment.json");
    expect(first?.value).toBe("app.example.com");
  });
});
