import { env } from "cloudflare:workers";

export interface TrackEventOpts {
  event: string;
  metadata?: string;
  resourceId?: string;
  resourceType?: string;
  userId?: string;
  value?: number;
}

export function trackEvent(opts: TrackEventOpts): void {
  const ae = env.PRODUCT_ANALYTICS;
  if (!ae) {
    return;
  }

  try {
    ae.writeDataPoint({
      indexes: [opts.event],
      blobs: [
        opts.userId ?? "",
        opts.event,
        opts.resourceType ?? "",
        opts.resourceId ?? "",
        opts.metadata ?? "",
      ],
      doubles: [1, opts.value ?? 0],
    });
  } catch {
    // Never let analytics failures affect the request
  }
}
