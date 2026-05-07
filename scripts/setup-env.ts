#!/usr/bin/env bun
// A7.1 — TS host-config generator. Reads root .env, derives the host bundle,
// and writes worker `vars` JSON fragments, `.dev.vars.tenancy` files, the web
// app `.env.development`, the local-harness Caddyfile, and the mkcert SAN
// list. The single source of truth is the root .env; running this twice is
// idempotent.
//
// After writing each `apps/<worker>/wrangler.jsonc.fragment.json`, the
// generator merges the fragment's `vars` block into the matching
// `apps/<worker>/wrangler.jsonc` in-place using a JSONC-aware editor so the
// fragment stays the audit artifact and `wrangler.jsonc` stays the single
// source of truth for non-Wrangler tooling (linters, IDE, OpenAPI gen).
// `bun run check:hosts` enforces parity between the two.
//
// Usage: `bun run setup:env` (from repo root)
// Tests: pass `{ fixture, outDir }` to `runSetupEnv` to write into a temp dir.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type Artifact,
  deriveHostConfig,
  loadRootEnv,
  type RootHostEnv,
  renderAllArtifacts,
} from "./lib/host-config";
import {
  mergeFragmentIntoWrangler,
  parseFragment,
} from "./lib/merge-wrangler-vars";

export type RunSetupEnvOptions = Readonly<{
  // Provide a fixture to bypass the .env file (used by tests).
  fixture?: RootHostEnv;
  // Where to write artifacts. Defaults to the repo root.
  outDir?: string;
  // Path to the root .env file (defaults to <outDir>/.env).
  envPath?: string;
}>;

export type RunSetupEnvResult = Readonly<{
  outDir: string;
  written: readonly string[];
  // wrangler.jsonc files that received fragment-merged vars.
  mergedWranglers: readonly string[];
}>;

const FRAGMENT_TO_WRANGLER: Readonly<Record<string, string>> = Object.freeze({
  "apps/server/wrangler.jsonc.fragment.json": "apps/server/wrangler.jsonc",
  "apps/auth/wrangler.jsonc.fragment.json": "apps/auth/wrangler.jsonc",
  "apps/admin/wrangler.jsonc.fragment.json": "apps/admin/wrangler.jsonc",
});

function isFragmentArtifact(artifact: Artifact): boolean {
  return artifact.path in FRAGMENT_TO_WRANGLER;
}

export async function runSetupEnv(
  opts: RunSetupEnvOptions = {}
): Promise<RunSetupEnvResult> {
  const outDir = opts.outDir ?? process.cwd();
  const env =
    opts.fixture ?? loadRootEnv(opts.envPath ?? resolve(outDir, ".env"));
  const cfg = deriveHostConfig(env);
  const artifacts = renderAllArtifacts(cfg);
  const written: string[] = [];
  const mergedWranglers: string[] = [];
  for (const artifact of artifacts) {
    const fullPath = resolve(outDir, artifact.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, artifact.content, "utf8");
    written.push(artifact.path);

    if (!isFragmentArtifact(artifact)) {
      continue;
    }
    const wranglerRel = FRAGMENT_TO_WRANGLER[artifact.path];
    if (wranglerRel === undefined) {
      continue;
    }
    const wranglerPath = resolve(outDir, wranglerRel);
    if (!existsSync(wranglerPath)) {
      // The wrangler.jsonc may not exist in test temp dirs; skip silently.
      continue;
    }
    const fragment = parseFragment(artifact.content);
    const original = readFileSync(wranglerPath, "utf8");
    const merged = mergeFragmentIntoWrangler(original, fragment);
    if (merged.changedKeys.length > 0) {
      writeFileSync(wranglerPath, merged.content, "utf8");
      mergedWranglers.push(wranglerRel);
    }
  }
  return { outDir, written, mergedWranglers };
}

if (import.meta.main) {
  const result = await runSetupEnv();
  for (const path of result.written) {
    process.stdout.write(`  Generated ${path}\n`);
  }
  for (const path of result.mergedWranglers) {
    process.stdout.write(`  Merged    ${path}\n`);
  }
  process.stdout.write(
    `\nDone. ${result.written.length} artifacts written from .env (${result.mergedWranglers.length} wrangler.jsonc files merged).\n`
  );
}
