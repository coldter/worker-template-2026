import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

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
  ...ultracite,
  ignorePatterns: [...(ultracite.ignorePatterns ?? []), ...projectIgnores],
});
