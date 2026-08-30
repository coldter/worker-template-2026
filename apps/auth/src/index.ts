import { WorkerEntrypoint } from "cloudflare:workers";
import { withDrizzleClient } from "@repo/db";
import { logger } from "@repo/shared/logger";
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

  private async recordRpc<T>(
    method: string,
    run: () => Promise<T>
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await run();
      this.writeRpcPoint(method, "ok", Date.now() - start);
      return result;
    } catch (error) {
      this.writeRpcPoint(method, "error", Date.now() - start);
      throw error;
    }
  }

  private writeRpcPoint(
    method: string,
    outcome: "ok" | "error",
    durationMs: number
  ): void {
    try {
      this.env.ANALYTICS?.writeDataPoint({
        blobs: [
          "rpc",
          method,
          outcome,
          this.env.CF_VERSION_METADATA?.id ?? null,
        ],
        doubles: [durationMs],
        indexes: [method],
      });
    } catch (error) {
      logger.debug("Analytics writeDataPoint failed", { error });
    }
  }

  async getSession(headers: Headers) {
    return this.recordRpc("getSession", () =>
      withDrizzleClient(
        this.env.HYPERDRIVE.connectionString,
        async (db) => {
          const auth = createAuth(db, this.env as AuthBindings, this.ctx);
          return await auth.api.getSession({ headers });
        },
        { logger: getDrizzleLogger(), waitUntil: (p) => this.ctx.waitUntil(p) }
      )
    );
  }
}

export default {
  fetch: (req: Request, env: CloudflareBindings, ctx: ExecutionContext) =>
    app.fetch(req, env, ctx),
};
