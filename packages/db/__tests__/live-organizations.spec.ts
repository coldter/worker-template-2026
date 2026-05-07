/**
 * Structural test for the `liveOrganizations` read seam.
 *
 * The audit-logging invariant in `.agent-docs/audit-logging.md` requires
 * every read of `organizations` to filter `WHERE deleted_at IS NULL`.
 * `packages/db/src/live-organizations.ts` is the sanctioned helper; this
 * test grep-walks the apps + packages tree and asserts that every callsite
 * either uses the helper or is in the allowlist below.
 *
 * If you legitimately need to bypass the helper (e.g. you manage
 * `deleted_at` directly inside a service, or you `SELECT ... FOR UPDATE`),
 * add the file path to ALLOWLIST and document the justification in the
 * file itself.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../");

/**
 * Files where bypassing `liveOrganizations` is justified.
 * Keep this list small; every entry is a tenancy invariant carve-out.
 */
const ALLOWLIST: string[] = [
  // Suspension / restore / delete service: manages deleted_at directly and
  // uses `SELECT ... FOR UPDATE` row locking. Filtering tombstones here
  // would hide the very rows the operations are trying to mutate.
  "apps/server/src/services/tenant-operations/index.ts",
  // Custom-host join lookup: explicit `isNull(organizations.deletedAt)` in
  // the WHERE clause; needs a join through tenant_custom_hostnames that
  // the relational query API does not surface.
  "packages/tenancy/src/resolve-tenant.ts",
  // Dev-seed contract test: runs against a fresh DB, no soft-deletes exist.
  "packages/db/__tests__/seed-dev.spec.ts",
  // The seam itself.
  "packages/db/src/live-organizations.ts",
  // Auth-tokens stateful verifier: structurally types the DB shape so it
  // does not depend on `@repo/db`. The lookup AND-merges
  // `deletedAt: { isNull: true }` inline (see `SessionVersionLookup` /
  // verifier callsite). Adding `liveOrganizations` here would re-introduce
  // the `@repo/db` dependency the package deliberately avoids.
  "packages/auth-tokens/src/verify.ts",
  // Tests for the auth-tokens verifier: the `findFirst` reference is a
  // mock assertion, not a real read.
  "packages/auth-tokens/src/__tests__/verify.test.ts",
];

/**
 * Walk a directory and yield every `.ts` / `.tsx` file path (relative to
 * the repo root). Skips node_modules, build outputs, and migration SQL.
 */
function* walkSourceFiles(rootDir: string): Generator<string> {
  const stack = [rootDir];
  const ignored = new Set([
    "node_modules",
    ".wrangler",
    ".wrangler-dry-run",
    "dist",
    "build",
    "coverage",
    ".turbo",
    ".next",
  ]);
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") {
        continue;
      }
      if (ignored.has(entry.name)) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && TS_FILE_RE.test(entry.name)) {
        yield path.relative(REPO_ROOT, full);
      }
    }
  }
}

const FROM_ORG_RE = /\bfrom\s*\(\s*organizations\s*\)/;
const QUERY_ORG_RE = /\bquery\s*\.\s*organizations\s*\.\s*find(First|Many)\b/;
const TS_FILE_RE = /\.(ts|tsx)$/;

describe("liveOrganizations read-seam invariant", () => {
  it("flags any direct organizations read outside the allowlist", () => {
    const apps = ["apps", "packages"]
      .map((d) => path.join(REPO_ROOT, d))
      .filter((d) => fs.existsSync(d));
    const offenders: { file: string; line: number; match: string }[] = [];
    for (const root of apps) {
      for (const file of walkSourceFiles(root)) {
        if (ALLOWLIST.includes(file)) {
          continue;
        }
        const abs = path.join(REPO_ROOT, file);
        let content: string;
        try {
          content = fs.readFileSync(abs, "utf-8");
        } catch {
          continue;
        }
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i] ?? "";
          if (FROM_ORG_RE.test(line)) {
            offenders.push({ file, line: i + 1, match: line.trim() });
          } else if (QUERY_ORG_RE.test(line)) {
            offenders.push({ file, line: i + 1, match: line.trim() });
          }
        }
      }
    }
    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `  ${o.file}:${o.line}\n    ${o.match}`)
        .join("\n");
      throw new Error(
        `Found ${offenders.length} direct organizations read(s) outside the allowlist. ` +
          "Use `liveOrganizations(executor)` from `@repo/db` instead, or add the file to " +
          "ALLOWLIST in this spec with a justification.\n" +
          detail
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it("allowlist files exist", () => {
    for (const rel of ALLOWLIST) {
      const abs = path.join(REPO_ROOT, rel);
      expect(fs.existsSync(abs), `Allowlist file not found: ${rel}`).toBe(true);
    }
  });
});
