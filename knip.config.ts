import type { KnipConfig } from "knip";

const config: KnipConfig = {
  ignore: [".agents/skills/**/templates/**", ".claude/skills/**/templates/**"],
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
      entry: ["scripts/**/*.ts", "mocks/**/*.ts", "tests/**/*.ts"],
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
