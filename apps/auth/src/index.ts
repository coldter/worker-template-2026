import { withDrizzleClient } from "@repo/db/client";
import { logger } from "@repo/shared/logger";
import { DrizzleLogger } from "@repo/shared/logger-drizzle";
import { WorkerEntrypoint } from "cloudflare:workers";

import { createAuth } from "./instance";
import type { AuthBindings } from "./instance";
import app from "./server";

const getDrizzleLogger = (nodeEnv: string) =>
  nodeEnv === "development" ? new DrizzleLogger() : undefined;

export class AuthEntrypoint extends WorkerEntrypoint<CloudflareBindings> {
  async fetch(request: Request): Promise<Response> {
    return await app.fetch(request, this.env, this.ctx);
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

  getSession(headers: Headers) {
    return this.recordRpc("getSession", () =>
      withDrizzleClient(
        this.env.HYPERDRIVE.connectionString,
        async (db) => {
          // SAFETY: the API service binding targets the server worker's ApiEntrypoint, so it exposes the ApiBindingRpc methods at runtime.
          const auth = createAuth(db, this.env as AuthBindings, this.ctx);

          return await auth.api.getSession({ headers });
        },
        {
          logger: getDrizzleLogger(this.env.NODE_ENV),
          waitUntil: (p) => this.ctx.waitUntil(p),
        }
      )
    );
  }
}

export default {
  fetch: (req: Request, env: CloudflareBindings, ctx: ExecutionContext) =>
    app.fetch(req, env, ctx),
};
