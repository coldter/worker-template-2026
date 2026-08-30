import type { AuthSession, AuthUser } from "@/lib/context";

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
