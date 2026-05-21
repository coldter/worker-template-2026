/**
 * Same-origin fetch helper. Cloudflare Access verifies the operator JWT at
 * the edge, so we use relative URLs and let the browser forward the
 * `cf-access-jwt-assertion` cookie.
 *
 * TODO(api-gen): wire `apps/admin/openapi.cache.json` into
 * `bun run generate-client` so operator pages can use the generated client
 * instead of this typed fetch wrapper.
 */

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    issues?: unknown;
  };
}

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody, fallback: string) {
    super(body.error?.message ?? fallback);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions<TBody = unknown> {
  body?: TBody;
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  search?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

function buildUrl(
  path: string,
  search: Record<string, string | number | undefined> | undefined
): string {
  if (!search) {
    return path;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query.length > 0 ? `${path}?${query}` : path;
}

export async function apiFetch<TResponse>(
  path: string,
  opts: RequestOptions = {}
): Promise<TResponse> {
  const url = buildUrl(path, opts.search);
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const response = await fetch(url, {
    method: opts.method ?? "GET",
    credentials: "include",
    headers,
    body,
    signal: opts.signal,
  });

  if (response.status === 204) {
    // boundary: 204 No Content has no body; caller declares TResponse=void.
    return undefined as TResponse;
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    // boundary: error body shape is contract-defined (optional code/message).
    const errBody = (parsed ?? {}) as ApiErrorBody;
    throw new ApiError(
      response.status,
      errBody,
      `Request failed with status ${response.status}`
    );
  }

  return parsed as TResponse;
}
