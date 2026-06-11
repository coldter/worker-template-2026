import { logger } from "@repo/shared/logger";

// Workflows run outside the HTTP middleware chain, so their completion rate
// and duration get their own unsampled data points, like requests and queue
// batches. The engine replays run() with cached step results after retries or
// hibernation, so a duration sample covers one engine invocation, not
// necessarily the end-to-end wall time of the instance.
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
