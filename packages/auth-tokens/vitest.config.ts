import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.spec.ts", "src/__tests__/**/*.test.ts"],
    globals: false,
    testTimeout: 30_000,
  },
});
