import { getBrandConfig } from "@repo/shared/brand";

// boundary: Vite injects `import.meta.env` at build time as an untyped record.
export const brand = getBrandConfig(
  import.meta.env as Record<string, string | undefined>
);
