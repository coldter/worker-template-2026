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
      miniflare: {
        // Stub the AUTH service binding for tests. Miniflare serviceBindings
        // only supports fetch-based stubs. For tests that exercise protected
        // routes (which call AUTH.getSession via RPC), mock the auth-context
        // middleware or use an auxiliary worker.
        serviceBindings: {
          AUTH: () => new Response("stub", { status: 503 }),
          // B4 — apps/app SPA. Tests stub the binding (or override env per
          // call); Miniflare still requires a default fetch handler so
          // wrangler config validation passes.
          STATIC_ASSETS: () =>
            new Response("<!doctype html>", {
              headers: { "content-type": "text/html" },
            }),
        },
      },
    }),
  },
});
