import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.spec.ts", "__tests__/**/*.test.ts"],
    globals: false,
    testTimeout: 30_000,
    // Spec files all share DATABASE_TEST_URL and call runMigrations, which
    // DROPs and recreates the public schema. Running them in parallel causes
    // schema-level races. Force sequential execution.
    fileParallelism: false,
  },
});
