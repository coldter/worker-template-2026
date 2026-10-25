import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import storybook from "ultracite/oxlint/storybook";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";

const projectIgnores = [
  "agent-ref/**",
  "ref-project/**",
  ".agents/**",
  ".claude/**",
  ".codex/**",
  ".continue/**",
  ".cursor/**",
  ".gemini/**",
  ".opencode/**",
  ".pi/**",
  ".roo/**",
  ".vscode/**",
  ".windsurf/**",
  "**/api.gen/**",
  "**/bts.jsonc",
  "**/openapi.cache.json",
  "**/worker-configuration.d.ts",
  "**/wrangler.jsonc",
  "packages/db/src/migrations/**",
];

export default defineConfig({
  env: core.env,
  extends: [core, react, vitest, storybook, tanstack, antiSlop],
  ignorePatterns: [...(core.ignorePatterns ?? []), ...projectIgnores],
  rules: {
    "oxc/no-barrel-file": ["error", { threshold: 1000 }],
  },
});
