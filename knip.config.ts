import type { KnipConfig } from "knip";

const config: KnipConfig = {
  ignoreExportsUsedInFile: true,
  tags: ["-lintignore"],
  ignoreDependencies: [
    "@typescript/native-preview",
    "cloudflare",
    "postcss",
    "tailwindcss",
    "tw-animate-css",
    "react-dom",
    "@types/react-dom",
    "drizzle-orm",
  ],
  ignore: [".agents/skills/**/templates/**", ".claude/skills/**/templates/**"],
  ignoreIssues: {
    "apps/web/src/modules/ui/**": ["exports"],
    "apps/web/src/modules/permissions/**": ["exports"],
    "packages/email/src/templates/**": ["duplicates"],
  },
  rules: {
    exports: "warn",
    types: "warn",
  },
  workspaces: {
    "apps/web": {
      entry: ["src/routes/**/*.tsx", "src/api-config.ts"],
      project: ["src/**/*.{ts,tsx}", "*.{ts,tsx}"],
      ignore: ["src/api.gen/**"],
      paths: {
        "@/*": ["./src/*"],
      },
    },
    "apps/server": {
      entry: ["scripts/**/*.ts", "mocks/**/*.ts", "tests/**/*.ts"],
      project: [
        "src/**/*.ts",
        "scripts/**/*.ts",
        "mocks/**/*.ts",
        "tests/**/*.ts",
        "*.ts",
      ],
      ignore: ["src/middlewares/**", "src/lib/**"],
      paths: {
        "@/*": ["./src/*"],
      },
    },
    "packages/email": {
      project: "**/*.{ts,tsx}",
    },
    "packages/shared": {
      project: "**/*.ts",
    },
    "packages/*": {
      project: "**/*.ts",
    },
  },
};

export default config;
