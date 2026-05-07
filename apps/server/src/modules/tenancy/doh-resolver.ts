import { z } from "zod";

/**
 * DoH (DNS-over-HTTPS) resolver shape used by `verifyTxtRecord` (D14).
 * The default implementation hits Cloudflare 1.1.1.1; tests inject a
 * deterministic stub.
 */
export const dohAnswerSchema = z
  .object({
    name: z.string().optional(),
    type: z.number().optional(),
    TTL: z.number().optional(),
    data: z.string().optional(),
  })
  .passthrough();

export const dohResponseSchema = z
  .object({
    Status: z.number().optional(),
    Answer: z.array(dohAnswerSchema).optional(),
  })
  .passthrough();

export type DohResponse = z.infer<typeof dohResponseSchema>;
export type DohAnswer = z.infer<typeof dohAnswerSchema>;

export type DohResolver = (name: string) => Promise<DohResponse>;

const CLOUDFLARE_DOH = "https://cloudflare-dns.com/dns-query";
const GOOGLE_DOH = "https://dns.google/resolve";
const DEFAULT_TIMEOUT_MS = 4000;

async function fetchDoh(
  base: string,
  name: string,
  fetchFn: typeof globalThis.fetch
): Promise<DohResponse> {
  const url = `${base}?name=${encodeURIComponent(name)}&type=TXT`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, {
      headers: { Accept: "application/dns-json" },
      signal: ctl.signal,
    });
    if (!res.ok) {
      throw new Error(`DoH ${base} returned ${res.status}`);
    }
    const text = await res.text();
    // boundary: HTTP response — Zod-validated below.
    const json = JSON.parse(text) as unknown;
    const parsed = dohResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error("DoH response did not match schema");
    }
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}

export const cloudflareDohResolver: DohResolver = (name) =>
  fetchDoh(CLOUDFLARE_DOH, name, globalThis.fetch);

export const googleDohResolver: DohResolver = (name) =>
  fetchDoh(GOOGLE_DOH, name, globalThis.fetch);

export const defaultDohResolvers: readonly DohResolver[] = [
  cloudflareDohResolver,
  googleDohResolver,
];
