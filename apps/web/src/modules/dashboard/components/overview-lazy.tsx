import { lazy, Suspense } from "react";
import { Skeleton } from "@/modules/ui/skeleton";

const Overview = lazy(() =>
  import("./overview").then((module) => ({ default: module.Overview }))
);

function OverviewFallback() {
  return <Skeleton className="h-[350px] w-full" />;
}

export function LazyOverview() {
  return (
    <Suspense fallback={<OverviewFallback />}>
      <Overview />
    </Suspense>
  );
}
