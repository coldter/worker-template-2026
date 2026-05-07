/**
 * Re-export shim for backward compatibility. The original helpers.ts mixed
 * column factories (used inside `pgTable(...)`) with row-array helpers (used
 * inside services). The two concerns now live in dedicated modules:
 *
 *   - `./schema/columns`   — `createdAt()`, `updatedAt()` column factories
 *   - `./query-helpers`    — `firstOrNull`, `firstOrThrow` row helpers
 *
 * Prefer importing from the dedicated modules in new code.
 */

export { firstOrNull, firstOrThrow } from "./query-helpers";
export { createdAt, updatedAt } from "./schema/columns";
