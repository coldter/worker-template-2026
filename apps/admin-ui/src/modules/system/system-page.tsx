import { Card, CardContent, CardHeader, CardTitle } from "@/modules/ui/card";

export function SystemPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-2xl">System</h2>
        <p className="text-muted-foreground text-sm">
          Queues, workflows, and platform health.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {/* TODO(operator-console-v2): wire to /api/admin/system/metrics. */}
            System metrics are not yet surfaced in the operator console.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
