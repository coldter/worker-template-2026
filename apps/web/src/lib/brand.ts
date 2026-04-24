import { getBrandConfig } from "@repo/shared/brand";

/**
 * Brand configuration resolved from `VITE_*` env vars at build time.
 *
 * Edit `apps/web/.env` (or the root `.env`) to rebrand the app without
 * touching source files.
 */
// boundary: Vite injects `import.meta.env` at build time as an untyped record.
export const brand = getBrandConfig(
  import.meta.env as Record<string, string | undefined>
);
