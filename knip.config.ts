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
    "apps/web/src/modules/permissions/**": ["exports"],
    "apps/web/src/modules/ui/**": ["exports"],
    "packages/email/src/templates/**": ["duplicates"],
  },
  rules: {
    exports: "warn",
    types: "warn",
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
      includeEntryExports: true,
      project: "**/*.ts",
    },
    "packages/email": {
      includeEntryExports: true,
      project: "**/*.{ts,tsx}",
    },
    "packages/shared": {
      includeEntryExports: true,
      project: "**/*.ts",
    },
  },
};

export default config;
