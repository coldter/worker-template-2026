import { lazy, Suspense } from "react";

import { Skeleton } from "@/modules/ui/skeleton";

const AnalyticsChart = lazy(() =>
  import("./analytics-chart").then((module) => ({
    default: module.AnalyticsChart,
  }))
);

const AnalyticsChartFallback = () => <Skeleton className="h-[300px] w-full" />;

export const LazyAnalyticsChart = () => (
  <Suspense fallback={<AnalyticsChartFallback />}>
    <AnalyticsChart />
  </Suspense>
);
