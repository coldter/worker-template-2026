type WaitUntilCtx = { waitUntil(p: Promise<unknown>): void } | undefined;

/**
 * Schedule a fire-and-forget promise with deadline safety.
 * Invariant: `.catch` is attached BEFORE `waitUntil`, so a synchronous
 * throw from `waitUntil` (closed isolate) cannot leave the promise as a
 * dangling unhandled rejection. If ctx is undefined the promise still
 * runs and is still caught.
 */
export function safeWaitUntil(
  ctx: WaitUntilCtx,
  promise: Promise<unknown>,
  onError?: (err: unknown) => void
): void {
  promise.catch(onError ?? (() => {}));
  if (!ctx) {
    return;
  }
  try {
    ctx.waitUntil(promise);
  } catch {
    // Closed isolate — catch attached above keeps promise safe.
  }
}
