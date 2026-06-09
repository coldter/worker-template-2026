import { lazy, Suspense } from "react";
import { Skeleton } from "@/modules/ui/skeleton";

const AnalyticsChart = lazy(() =>
  import("./analytics-chart").then((module) => ({
    default: module.AnalyticsChart,
  }))
);

function AnalyticsChartFallback() {
  return <Skeleton className="h-[300px] w-full" />;
}

export function LazyAnalyticsChart() {
  return (
    <Suspense fallback={<AnalyticsChartFallback />}>
      <AnalyticsChart />
    </Suspense>
  );
}
