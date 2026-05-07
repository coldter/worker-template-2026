import type { DohResolver, DohResponse } from "./doh-resolver";

/**
 * D14 TXT pre-verification. The tenant places a TXT record at
 * `${verificationLabel}.<host>` with our per-row verification token; we
 * resolve it via DoH BEFORE issuing any Cloudflare API call. We hedge with
 * dual resolvers (Cloudflare + Google) — pass if EITHER returns a match.
 */
export type VerifyTxtResult =
  | { ok: true }
  | { ok: false; reason: "no_record" | "mismatch" | "resolver_error" };

export type VerifyTxtDeps = Readonly<{
  /** Either a single resolver or an array of resolvers (dual hedge). */
  dohResolver: DohResolver | readonly DohResolver[];
  verificationLabel: string;
}>;

const NXDOMAIN_STATUS = 3;

const QUOTE_STRIP_RE = /^"(.*)"$/;

function unquote(data: string): string {
  // DoH JSON wraps TXT data in double-quotes (sometimes multi-string).
  return data.replace(QUOTE_STRIP_RE, "$1");
}

function classifyAnswers(
  response: DohResponse,
  expectedToken: string
): VerifyTxtResult {
  if (response.Status === NXDOMAIN_STATUS) {
    return { ok: false, reason: "no_record" };
  }
  const answers = response.Answer ?? [];
  if (answers.length === 0) {
    return { ok: false, reason: "no_record" };
  }
  let sawAnyTxt = false;
  for (const a of answers) {
    if (typeof a.data !== "string") {
      continue;
    }
    sawAnyTxt = true;
    if (unquote(a.data) === expectedToken) {
      return { ok: true };
    }
  }
  if (!sawAnyTxt) {
    return { ok: false, reason: "no_record" };
  }
  return { ok: false, reason: "mismatch" };
}

export async function verifyTxtRecord(
  hostname: string,
  expectedToken: string,
  deps: VerifyTxtDeps
): Promise<VerifyTxtResult> {
  const fullName = `${deps.verificationLabel}.${hostname}`;
  const resolvers = Array.isArray(deps.dohResolver)
    ? deps.dohResolver
    : [deps.dohResolver as DohResolver];

  // Run all resolvers in parallel; pass if ANY returns ok=true. Aggregate
  // failure-reasons so the caller surfaces the best one.
  const settled = await Promise.allSettled(resolvers.map((r) => r(fullName)));
  const results: VerifyTxtResult[] = [];
  for (const s of settled) {
    if (s.status === "rejected") {
      results.push({ ok: false, reason: "resolver_error" });
      continue;
    }
    results.push(classifyAnswers(s.value, expectedToken));
  }

  if (results.some((r) => r.ok)) {
    return { ok: true };
  }
  // Prefer mismatch > no_record > resolver_error so we surface the most
  // actionable message to the tenant.
  for (const reason of ["mismatch", "no_record", "resolver_error"] as const) {
    const found = results.find((r) => !r.ok && r.reason === reason);
    if (found) {
      return found;
    }
  }
  return { ok: false, reason: "resolver_error" };
}
