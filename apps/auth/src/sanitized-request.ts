import type { Tenant } from "@repo/tenancy";

const STRIP = [
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-forwarded-for",
  "forwarded",
  "cf-connecting-ip",
] as const;

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

// boundary: undici/workerd RequestInit requires `duplex: "half"` when streaming
// a body via ReadableStream; the platform types don't yet include the field.
type RequestInitWithDuplex = RequestInit & { duplex?: "half" };

export function sanitizedAuthRequest(req: Request, tenant: Tenant): Request {
  const url = new URL(req.url);
  url.host = tenant.host;
  url.protocol = "https:";
  const headers = new Headers(req.headers);
  for (const name of STRIP) {
    headers.delete(name);
  }
  headers.set("host", tenant.host);
  const hasBody = !METHODS_WITHOUT_BODY.has(req.method);
  const init: RequestInitWithDuplex = {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    redirect: "manual",
  };
  if (hasBody) {
    init.duplex = "half";
  }
  return new Request(url.toString(), init);
}
