import type { AuthSession, AuthUser } from "@/lib/context";

/**
 * Type augmentation for the AUTH service binding.
 *
 * The auto-generated `Service` type from wrangler does not resolve RPC
 * methods across apps. This declaration merges into CloudflareBindings
 * so TypeScript knows about `AUTH.getSession()` in addition to the
 * default `fetch()` / `connect()` methods.
 */

interface AuthServiceBinding {
  fetch(request: Request): Promise<Response>;
  getSession(
    headers: Headers
  ): Promise<{ user: AuthUser; session: AuthSession } | null>;
}

declare global {
  interface CloudflareBindings {
    AUTH: AuthServiceBinding;
  }
}
