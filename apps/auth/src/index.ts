import { WorkerEntrypoint } from "cloudflare:workers";
import { createDrizzleClient } from "@repo/db/client";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { Client } from "pg";
import { type AuthBindings, createAuth } from "./instance";
import app from "./server";

export class AuthEntrypoint extends WorkerEntrypoint<CloudflareBindings> {
  async fetch(request: Request): Promise<Response> {
    return app.fetch(request, this.env, this.ctx);
  }

  async getSession(headers: Headers) {
    const client = new Client({
      connectionString: this.env.HYPERDRIVE.connectionString,
    });
    await client.connect();
    try {
      const db = createDrizzleClient(
        client,
        process.env.NODE_ENV === "development" ? new DrizzleLogger() : undefined
      );
      const auth = createAuth(db, this.env as AuthBindings, this.ctx);
      return await auth.api.getSession({ headers });
    } finally {
      this.ctx.waitUntil(client.end());
    }
  }

  async getToken(headers: Headers) {
    const client = new Client({
      connectionString: this.env.HYPERDRIVE.connectionString,
    });
    await client.connect();
    try {
      const db = createDrizzleClient(
        client,
        process.env.NODE_ENV === "development" ? new DrizzleLogger() : undefined
      );
      const auth = createAuth(db, this.env as AuthBindings, this.ctx);
      return await auth.api.getToken({ headers });
    } finally {
      this.ctx.waitUntil(client.end());
    }
  }
}

export default {
  fetch: (req: Request, env: CloudflareBindings, ctx: ExecutionContext) =>
    app.fetch(req, env, ctx),
};
