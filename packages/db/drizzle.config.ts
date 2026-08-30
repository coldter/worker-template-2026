import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dbCredentials: {
    url:
      (process.env.NODE_ENV === "test"
        ? process.env.DATABASE_TEST_URL
        : process.env.DATABASE_URL || "") || "",
  },
  dialect: "postgresql",
  out: "./src/migrations",
  schema: "./src/schema/index.ts",
});
