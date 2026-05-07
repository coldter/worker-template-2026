import { Button } from "@/modules/ui/button";
import { Card, CardContent, CardHeader } from "@/modules/ui/card";

interface SessionExpiredProps {
  status?: number;
}

/**
 * Operators authenticate via Cloudflare Access. When the SPA's identity
 * probe (`GET /api/admin/me`) returns 401/403, the access-token cookie is
 * either missing or expired. The user must reload the page so Cloudflare
 * Access can redirect them to the IdP and re-issue a fresh JWT cookie.
 */
export function SessionExpired({ status }: SessionExpiredProps) {
  const reload = () => window.location.reload();
  return (
    <div className="grid min-h-svh place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="font-semibold text-2xl">Session expired</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Refresh to re-authenticate via Cloudflare Access.
          </p>
        </CardHeader>
        <CardContent>
          {status ? (
            <p className="mb-4 text-muted-foreground text-xs">
              Identity probe responded with HTTP {status}.
            </p>
          ) : null}
          <Button onClick={reload} type="button">
            Refresh
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
