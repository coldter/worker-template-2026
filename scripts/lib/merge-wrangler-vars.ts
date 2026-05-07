// JSONC-aware merger that updates the `vars` block of a `wrangler.jsonc`
// file in-place from a generated `wrangler.jsonc.fragment.json` payload.
//
// `wrangler.jsonc` carries hand-written comments (binding rationales, deploy
// TODOs) that must survive regeneration; using `jsonc-parser`'s `modify` API
// preserves the surrounding trivia (comments, trailing commas, formatting)
// while only patching the leaf string values.
//
// The merger is deliberately narrow: it only writes keys present in the
// fragment, and it only writes `vars.<KEY>`. It never touches other top-level
// blocks (`services`, `secrets`, etc.) and never adds keys not present in the
// fragment.

import {
  applyEdits,
  type JSONPath,
  modify,
  type ParseError,
  parse as parseJsonc,
} from "jsonc-parser";

export type WranglerFragment = Readonly<{
  vars: Readonly<Record<string, string>>;
}>;

export type MergeResult = Readonly<{
  // Final JSONC text after applying every edit.
  content: string;
  // Keys that received a value change vs. what was already on disk.
  changedKeys: readonly string[];
}>;

const FORMATTING = {
  formattingOptions: {
    insertSpaces: true,
    tabSize: 2,
    eol: "\n",
  },
} as const;

export function parseFragment(raw: string): WranglerFragment {
  // The fragment is a generated artifact with a leading `// GENERATED ...`
  // banner; the rest is JSON. `jsonc-parser` handles the comment without
  // needing a strip step.
  const errors: ParseError[] = [];
  const value = parseJsonc(raw, errors, { allowTrailingComma: false });
  if (errors.length > 0) {
    throw new Error(
      `merge-wrangler-vars: fragment parse error (${errors.length} issue${errors.length === 1 ? "" : "s"})`
    );
  }
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.vars !== "object" ||
    value.vars === null
  ) {
    throw new Error("merge-wrangler-vars: fragment must be { vars: { ... } }");
  }
  const vars: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value.vars)) {
    if (typeof raw !== "string") {
      throw new Error(
        `merge-wrangler-vars: fragment.vars.${key} must be a string`
      );
    }
    vars[key] = raw;
  }
  return Object.freeze({ vars: Object.freeze(vars) });
}

export function mergeFragmentIntoWrangler(
  wranglerJsonc: string,
  fragment: WranglerFragment
): MergeResult {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(wranglerJsonc, errors, {
    allowTrailingComma: true,
  });
  if (errors.length > 0) {
    throw new Error(
      `merge-wrangler-vars: wrangler.jsonc parse error (${errors.length} issue${errors.length === 1 ? "" : "s"})`
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("merge-wrangler-vars: wrangler.jsonc must be an object");
  }
  const existingVars =
    typeof parsed.vars === "object" && parsed.vars !== null
      ? (parsed.vars as Record<string, unknown>)
      : {};

  let next = wranglerJsonc;
  const changed: string[] = [];
  for (const [key, value] of Object.entries(fragment.vars)) {
    if (existingVars[key] === value) {
      continue;
    }
    const path: JSONPath = ["vars", key];
    const edits = modify(next, path, value, FORMATTING);
    next = applyEdits(next, edits);
    changed.push(key);
  }
  return Object.freeze({ content: next, changedKeys: changed });
}

export type ParityIssue = Readonly<{
  key: string;
  reason: "missing-in-wrangler" | "value-mismatch";
  expected: string;
  actual?: string;
}>;

/**
 * Compares the rendered fragment against the live wrangler.jsonc and reports
 * any keys that do not match. Used by `check-hosts` so a hand-edit to
 * `wrangler.jsonc` that drifts from the generator output fails CI.
 */
export function diffFragmentAgainstWrangler(
  wranglerJsonc: string,
  fragment: WranglerFragment
): ParityIssue[] {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(wranglerJsonc, errors, {
    allowTrailingComma: true,
  });
  if (errors.length > 0) {
    throw new Error(
      `merge-wrangler-vars: wrangler.jsonc parse error (${errors.length} issue${errors.length === 1 ? "" : "s"})`
    );
  }
  const issues: ParityIssue[] = [];
  const existingVars =
    typeof parsed === "object" &&
    parsed !== null &&
    typeof parsed.vars === "object" &&
    parsed.vars !== null
      ? (parsed.vars as Record<string, unknown>)
      : {};
  for (const [key, expected] of Object.entries(fragment.vars)) {
    const actual = existingVars[key];
    if (actual === undefined) {
      issues.push({ key, reason: "missing-in-wrangler", expected });
      continue;
    }
    if (typeof actual !== "string" || actual !== expected) {
      issues.push({
        key,
        reason: "value-mismatch",
        expected,
        actual: typeof actual === "string" ? actual : JSON.stringify(actual),
      });
    }
  }
  return issues;
}
