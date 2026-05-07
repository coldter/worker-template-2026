import { createFileRoute } from "@tanstack/react-router";
import { OperatorLayout } from "@/modules/layout/operator-layout";

export const Route = createFileRoute("/_app")({
  component: OperatorLayout,
});
