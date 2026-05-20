/**
 * Minimal typed fetch wrapper for the admin worker.
 *
 * The admin worker serves this SPA same-origin. Cloudflare Access verifies
 * the operator JWT at the edge before any request reaches the worker, so we
 * just call relative URLs and let the browser forward the
 * `cf-access-jwt-assertion` cookie.
 *
 * TODO(api-gen): Wave 1 generated `src/api.gen` from the server worker spec
 * (`apps/server/openapi.cache.json`). The admin worker has its own OpenAPI
 * surface that has not been wired into `bun run generate-client` yet —
 * `apps/admin/openapi.cache.json` does not exist on disk. Until then,
 * operator pages talk to the admin worker through this typed fetch helper.
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
    // boundary: server contract reserves `error.message` and `error.code`;
    // we treat the body as `ApiErrorBody` with optional fields rather than
    // running a full Zod parse on every error response.
    const errBody = (parsed ?? {}) as ApiErrorBody;
    throw new ApiError(
      response.status,
      errBody,
      `Request failed with status ${response.status}`
    );
  }

  return parsed as TResponse;
}
