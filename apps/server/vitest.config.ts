import path from "node:path";
import { cloudflarePool } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    pool: cloudflarePool({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  },
});
