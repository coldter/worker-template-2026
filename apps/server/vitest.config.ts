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
      miniflare: {
        // Stub the AUTH service binding for tests. Miniflare serviceBindings
        // only supports fetch-based stubs. For tests that exercise protected
        // routes (which call AUTH.getSession via RPC), mock the auth-context
        // middleware or use an auxiliary worker.
        serviceBindings: {
          AUTH: () => new Response("stub", { status: 503 }),
        },
      },
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  },
});
