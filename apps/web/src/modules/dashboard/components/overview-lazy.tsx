import { lazy, Suspense } from "react";

import { Skeleton } from "@/modules/ui/skeleton";

const Overview = lazy(() =>
  import("./overview").then((module) => ({ default: module.Overview }))
);

const OverviewFallback = () => <Skeleton className="h-[350px] w-full" />;

export const LazyOverview = () => (
  <Suspense fallback={<OverviewFallback />}>
    <Overview />
  </Suspense>
);
