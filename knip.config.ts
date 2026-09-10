import type { KnipConfig } from "knip";

const config: KnipConfig = {
  ignore: [".agents/skills/**/templates/**"],
  ignoreDependencies: [
    "cloudflare",
    "postcss",
    "tailwindcss",
    "tw-animate-css",
    "drizzle-orm",
  ],
  ignoreExportsUsedInFile: true,
  ignoreIssues: {
    "packages/email/src/templates/**": ["duplicates"],
  },
  rules: {
    exports: "off",
    types: "off",
  },
  tags: ["-lintignore"],
  workspaces: {
    "apps/server": {
      entry: [
        "scripts/**/*.ts",
        "mocks/**/*.ts",
        "tests/**/*.ts",
        "src/**/*.test.ts",
      ],
      ignore: ["src/middlewares/**", "src/lib/**"],
      paths: {
        "@/*": ["./src/*"],
      },
      project: [
        "src/**/*.ts",
        "scripts/**/*.ts",
        "mocks/**/*.ts",
        "tests/**/*.ts",
        "*.ts",
      ],
    },
    "apps/web": {
      entry: ["src/routes/**/*.tsx", "src/api-config.ts"],
      ignore: ["src/api.gen/**"],
      paths: {
        "@/*": ["./src/*"],
      },
      project: ["src/**/*.{ts,tsx}", "*.{ts,tsx}"],
    },
    "packages/*": {
      project: "**/*.ts",
    },
    "packages/email": {
      project: "**/*.{ts,tsx}",
    },
    "packages/shared": {
      project: "**/*.ts",
    },
  },
};

export default config;
