import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UserConfig } from "@hey-api/openapi-ts";
import { defineConfig } from "@hey-api/openapi-ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Hey API code generation config.
 *
 * Zod plugin tradeoff: it emits tree-shakeable runtime schemas for
 * request/response bodies. Kept enabled because catching server/client
 * contract drift at runtime is worth the cost; if bundle size becomes a
 * concern, drop the `zod` entry below.
 */
export const openApiConfig: UserConfig = {
  input: {
    path: path.resolve(__dirname, "../server/openapi.cache.json"),
    watch: false,
  },
  output: {
    path: path.resolve(__dirname, "./src/api.gen"),
    postProcess: [],
  },
  parser: {
    transforms: {
      readWrite: false,
    },
  },
  plugins: [
    {
      name: "@hey-api/client-fetch",
      runtimeConfigPath: "@/api-config",
      throwOnError: true,
    },
    {
      name: "@hey-api/sdk",
      responseStyle: "data",
    },
    {
      infiniteQueryKeys: true,
      infiniteQueryOptions: true,
      mutationOptions: true,
      // Generate typed `queryOptions`, query keys, and mutation options
      // helpers. We do not enable the opinionated `useQuery` / `useMutation`
      // hook generators because the repo already has custom query hooks in
      // `apps/web/src/modules/*/query.ts` that layer on permission guards
      // and toast handling. Callers should compose with `queryOptions`.
      name: "@tanstack/react-query",
      queryKeys: true,
      queryOptions: true,
    },
    {
      name: "zod",
    },
  ],
};

export default defineConfig(openApiConfig);
