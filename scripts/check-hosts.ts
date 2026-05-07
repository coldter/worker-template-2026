#!/usr/bin/env bun
// A7.2 — host-config drift checker. Re-runs the generator in memory and
// diffs the rendered artifacts against what's on disk. Also runs the
// hardcoded-host leak detector (A7.11) so a forgotten interpolation in a
// renderer is caught before deploy. Lastly, asserts the `vars` block of
// each `wrangler.jsonc` matches the matching `wrangler.jsonc.fragment.json`
// (parity check) so a hand-edit to either side fails CI.
//
// Usage: `bun run check:hosts` (run from repo root)
// Tests: pass `{ rootDir }` to `runCheckHosts`.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Artifact,
  deriveHostConfig,
  findHardcodedHosts,
  loadRootEnv,
  type RootHostEnv,
  renderAllArtifacts,
} from "./lib/host-config";
import {
  diffFragmentAgainstWrangler,
  parseFragment,
} from "./lib/merge-wrangler-vars";

export type DriftEntry = Readonly<{
  path: string;
  reason:
    | "missing"
    | "mismatch"
    | "hardcoded-host-leak"
    | "wrangler-vars-parity";
  expected?: string;
  actual?: string;
  detail?: string;
}>;

export type CheckHostsResult = Readonly<{
  ok: boolean;
  drift: readonly DriftEntry[];
}>;

export type RunCheckHostsOptions = Readonly<{
  rootDir: string;
  // Compare with this fixture. When omitted, loads from `<rootDir>/.env`.
  fixture?: RootHostEnv;
  // Reference baseline used by the hardcoded-host leak detector. Defaults to
  // the active env (which makes the leak detector a no-op). Tests pass a
  // baseline that differs from the active env to assert the detector fires.
  hardcodedBaseline?: RootHostEnv;
  envPath?: string;
}>;

const FRAGMENT_TO_WRANGLER: Readonly<Record<string, string>> = Object.freeze({
  "apps/server/wrangler.jsonc.fragment.json": "apps/server/wrangler.jsonc",
  "apps/auth/wrangler.jsonc.fragment.json": "apps/auth/wrangler.jsonc",
  "apps/admin/wrangler.jsonc.fragment.json": "apps/admin/wrangler.jsonc",
});

function isFragmentArtifact(artifact: Artifact): boolean {
  return artifact.path in FRAGMENT_TO_WRANGLER;
}

export async function runCheckHosts(
  opts: RunCheckHostsOptions
): Promise<CheckHostsResult> {
  const env =
    opts.fixture ?? loadRootEnv(opts.envPath ?? resolve(opts.rootDir, ".env"));
  const cfg = deriveHostConfig(env);
  const expected = renderAllArtifacts(cfg);
  const drift: DriftEntry[] = [];

  for (const artifact of expected) {
    const fullPath = resolve(opts.rootDir, artifact.path);
    if (!existsSync(fullPath)) {
      drift.push({ path: artifact.path, reason: "missing" });
      continue;
    }
    const actual = readFileSync(fullPath, "utf8");
    if (actual !== artifact.content) {
      drift.push({
        path: artifact.path,
        reason: "mismatch",
        expected: artifact.content,
        actual,
      });
    }
  }

  const baseline = opts.hardcodedBaseline ?? env;
  const leaks = findHardcodedHosts(expected, baseline, env);
  for (const leak of leaks) {
    drift.push({
      path: leak.path,
      reason: "hardcoded-host-leak",
      detail: `line ${leak.line}: ${leak.value}`,
    });
  }

  // Parity: every fragment must match the matching wrangler.jsonc vars block.
  for (const artifact of expected) {
    if (!isFragmentArtifact(artifact)) {
      continue;
    }
    const wranglerRel = FRAGMENT_TO_WRANGLER[artifact.path];
    if (wranglerRel === undefined) {
      continue;
    }
    const wranglerPath = resolve(opts.rootDir, wranglerRel);
    if (!existsSync(wranglerPath)) {
      continue;
    }
    const fragment = parseFragment(artifact.content);
    const wranglerText = readFileSync(wranglerPath, "utf8");
    const issues = diffFragmentAgainstWrangler(wranglerText, fragment);
    for (const issue of issues) {
      drift.push({
        path: wranglerRel,
        reason: "wrangler-vars-parity",
        detail: `${issue.key}: ${issue.reason} (expected "${issue.expected}", actual "${issue.actual ?? ""}")`,
      });
    }
  }

  return { ok: drift.length === 0, drift };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  let envPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--env-path" && i + 1 < argv.length) {
      envPath = argv[i + 1];
    }
  }
  const result = await runCheckHosts({ rootDir: process.cwd(), envPath });
  if (result.ok) {
    process.stdout.write("host-config OK\n");
    process.exit(0);
  }
  process.stderr.write("host-config drift:\n");
  for (const entry of result.drift) {
    if (entry.reason === "mismatch") {
      process.stderr.write(`  mismatch: ${entry.path}\n`);
    } else if (entry.reason === "missing") {
      process.stderr.write(`  missing:  ${entry.path}\n`);
    } else if (entry.reason === "wrangler-vars-parity") {
      process.stderr.write(
        `  parity:   ${entry.path} (${entry.detail ?? ""})\n`
      );
    } else {
      process.stderr.write(
        `  leak:     ${entry.path} (${entry.detail ?? ""})\n`
      );
    }
  }
  process.stderr.write(
    "\nFix: run `bun run setup:env` to regenerate, or revert hand edits.\n"
  );
  process.exit(1);
}
