import { Construction } from "lucide-react";

import { Button } from "@/modules/ui/button";

export const MaintenanceError = () => (
  <div className="flex h-svh w-full items-center justify-center">
    <div className="flex flex-col items-center gap-6 px-4 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-500/10">
        <Construction className="h-10 w-10 text-amber-500" />
      </div>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Under Maintenance</h1>
        <p className="text-muted-foreground max-w-md">
          The site is not available at the moment. We&apos;ll be back online
          shortly.
        </p>
      </div>

      <p className="text-muted-foreground text-sm">Status Code: 503</p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="outline">Learn more</Button>
      </div>

      <p className="text-muted-foreground text-sm">
        Thank you for your patience. Check back soon for updates.
      </p>
    </div>
  </div>
);
