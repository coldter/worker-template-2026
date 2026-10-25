import { useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, FileQuestion, Home } from "lucide-react";

import { Button } from "@/modules/ui/button";

export const NotFoundError = () => {
  const navigate = useNavigate();
  const { history } = useRouter();

  return (
    <div className="flex h-svh w-full items-center justify-center">
      <div className="flex flex-col items-center gap-6 px-4 text-center">
        <div className="bg-muted/10 flex h-20 w-20 items-center justify-center rounded-full">
          <FileQuestion className="text-muted-foreground h-10 w-10" />
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Page Not Found</h1>
          <p className="text-muted-foreground max-w-md">
            It seems like the page you&apos;re looking for does not exist or
            might have been removed.
          </p>
        </div>

        <p className="text-muted-foreground text-sm">Error Code: 404</p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button onClick={() => history.go(-1)} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Go Back
          </Button>
          <Button onClick={() => navigate({ to: "/" })}>
            <Home className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
        </div>

        <p className="text-muted-foreground text-sm">
          You can also search for what you&apos;re looking for or use the
          navigation.
        </p>
      </div>
    </div>
  );
};
