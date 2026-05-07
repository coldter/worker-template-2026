import { createFileRoute } from "@tanstack/react-router";
import { SystemPage } from "@/modules/system/system-page";

export const Route = createFileRoute("/_app/system")({
  component: SystemPage,
});
