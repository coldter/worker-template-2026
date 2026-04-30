import { WorkerEntrypoint } from "cloudflare:workers";
import { withDrizzleClient } from "@repo/db";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { type AuthBindings, createAuth } from "./instance";
import app from "./server";

function getDrizzleLogger() {
  return process.env.NODE_ENV === "development"
    ? new DrizzleLogger()
    : undefined;
}

export class AuthEntrypoint extends WorkerEntrypoint<CloudflareBindings> {
  async fetch(request: Request): Promise<Response> {
    return app.fetch(request, this.env, this.ctx);
  }

  async getSession(headers: Headers) {
    return withDrizzleClient(
      this.env.HYPERDRIVE.connectionString,
      async (db) => {
        const auth = createAuth(db, this.env as AuthBindings, this.ctx);
        return await auth.api.getSession({ headers });
      },
      { logger: getDrizzleLogger(), waitUntil: (p) => this.ctx.waitUntil(p) }
    );
  }

  async getToken(headers: Headers) {
    return withDrizzleClient(
      this.env.HYPERDRIVE.connectionString,
      async (db) => {
        const auth = createAuth(db, this.env as AuthBindings, this.ctx);
        return await auth.api.getToken({ headers });
      },
      { logger: getDrizzleLogger(), waitUntil: (p) => this.ctx.waitUntil(p) }
    );
  }
}

export default {
  fetch: (req: Request, env: CloudflareBindings, ctx: ExecutionContext) =>
    app.fetch(req, env, ctx),
};
