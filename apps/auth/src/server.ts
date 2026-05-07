import { withDrizzleClient } from "@repo/db";
import type { createDrizzleClient } from "@repo/db/client";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import type { Invalidator } from "@repo/tenancy";
import { Hono } from "hono";
import { trimTrailingSlash } from "hono/trailing-slash";
import { createAuthInvalidator } from "./invalidator";

type AuthEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    db: ReturnType<typeof createDrizzleClient>;
    invalidator: Invalidator;
  };
};

const app = new Hono<AuthEnv>();

app.use("*", trimTrailingSlash());

// Tenancy own-colo invalidator — attached early so any later handler can
// reuse it without re-instantiating per request (the factory itself is cheap;
// keeping a single reference per request matches the server-side pattern).
app.use("*", async (c, next) => {
  c.set("invalidator", createAuthInvalidator(c.env));
  await next();
});

// DB middleware - creates and manages connection per request
app.use("*", async (c, next) => {
  await withDrizzleClient(
    c.env.HYPERDRIVE.connectionString,
    async (db) => {
      c.set("db", db);
      await next();
    },
    {
      logger:
        process.env.NODE_ENV === "development"
          ? new DrizzleLogger()
          : undefined,
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    }
  );
});

// SECURITY: there is no default `app.all("/*")` route that hands the request
// to a `tenant: null` Better Auth instance. All inbound traffic must arrive
// via `AuthEntrypoint.handleAuthRequest` (which sanitises and pins the tenant
// host) or `AuthEntrypoint.fetch` (which 421s direct hits). Wiring a fallback
// here would re-introduce the Wave-1 audit finding where direct fetches to
// the auth worker minted apex JWTs and skipped tenant membership enforcement.
app.all("/*", (c) =>
  c.json({ error: "auth worker reachable only via service binding" }, 421)
);

export default app;
