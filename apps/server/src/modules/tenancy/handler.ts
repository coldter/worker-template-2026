import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "@/lib/context";
import { defaultHook } from "@/utils/default-hook";
import { tenancyCurrentHandler } from "./current";

const app = new OpenAPIHono<AppEnv>({ defaultHook });

// Mounted at /api/tenancy/current. The route is reachable without a session
// (the SPA bootstrap calls it before login) so it does not run through the
// auth-context middleware. OpenAPI registration is deferred to b6 / c-phase
// once the response shape stabilises beyond the Phase A surface from D78.
app.get("/", (c) => tenancyCurrentHandler(c));

export default app;
