import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "node_modules/.vitest",
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
