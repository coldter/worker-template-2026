import { logger } from "@repo/shared/logger";

export async function runWithWorkflowMetrics<T>(
  env: CloudflareBindings,
  workflow: string,
  run: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await run();
    recordOutcome(env, workflow, "ok", Date.now() - start);
    return result;
  } catch (error) {
    recordOutcome(env, workflow, "error", Date.now() - start);
    throw error;
  }
}

function recordOutcome(
  env: CloudflareBindings,
  workflow: string,
  outcome: "ok" | "error",
  durationMs: number
): void {
  try {
    env.ANALYTICS?.writeDataPoint({
      blobs: [
        "workflow",
        workflow,
        outcome,
        env.CF_VERSION_METADATA?.id ?? null,
      ],
      doubles: [durationMs],
      indexes: [workflow],
    });
  } catch (error) {
    logger.debug("Workflow analytics writeDataPoint failed", { error });
  }
}
