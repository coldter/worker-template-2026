import type { ErrorComponentProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { catch as catchSchema } from "zod/mini";
import * as z from "zod/mini";

import { reportableErrorSchema, reportError } from "@/lib/report-error";
import { Button } from "@/modules/ui/button";
import { Card, CardContent, CardHeader } from "@/modules/ui/card";

const boundaryErrorSchema = catchSchema(
  z.union([
    z.pipe(
      z.instanceof(Error),
      z.transform((caught) => {
        try {
          return {
            message: caught.message || JSON.stringify(caught),
            stack: caught.stack,
          };
        } catch {
          return { message: "Something went wrong.", stack: caught.stack };
        }
      })
    ),
    z.pipe(
      z.string(),
      z.transform((message) => ({ message, stack: undefined }))
    ),
  ]),
  (ctx) => {
    try {
      return {
        message: JSON.stringify(ctx.value) ?? String(ctx.value),
        stack: undefined,
      };
    } catch {
      return { message: "Something went wrong.", stack: undefined };
    }
  }
);

const AppError = ({ error, reset }: ErrorComponentProps) => {
  const isDev = import.meta.env.DEV;
  const { message, stack } = boundaryErrorSchema.parse(error);

  useEffect(() => {
    reportError(reportableErrorSchema.parse(error), {
      source: "router-error-boundary",
    });
  }, [error]);

  return (
    <div className="grid min-h-svh place-items-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <h1 className="text-2xl font-semibold">Unexpected error</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            The application encountered an unexpected condition. You can try
            again or go back home.
          </p>
        </CardHeader>
        <CardContent>
          {isDev ? (
            <>
              <div className="bg-muted/30 rounded-md border p-3 text-sm">
                <p className="font-medium">Message</p>
                <p className="text-muted-foreground mt-1">{message}</p>
              </div>
              <p className="mt-4 text-sm font-medium">Stack trace</p>
              <pre className="bg-muted/30 mt-2 max-h-60 overflow-auto rounded-md border p-3 text-xs">
                {stack}
              </pre>
            </>
          ) : null}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Button className="w-full sm:w-auto" onClick={reset} type="button">
              Try again
            </Button>
            <Button
              asChild
              className="w-full sm:w-auto"
              type="button"
              variant="outline"
            >
              <Link to="/">Go home</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AppError;
