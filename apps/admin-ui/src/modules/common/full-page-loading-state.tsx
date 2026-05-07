import { Spinner } from "@/modules/ui/spinner";

export interface FullPageLoadingStateProps {
  description?: string;
  title?: string;
}

export function FullPageLoadingState({
  title = "Fetching...",
  description = "Please wait while we fetch your data...",
}: FullPageLoadingStateProps) {
  return (
    <div className="flex min-h-[calc(100vh-theme(spacing.16))] items-center justify-center p-4 text-center">
      <div className="flex w-full max-w-xl flex-col items-center justify-center p-8">
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-card shadow-sm">
          <Spinner size="xl" />
        </div>
        <div className="mb-4 space-y-1">
          <h1 className="font-semibold text-2xl">{title}</h1>
          {description && (
            <p className="font-medium text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
    </div>
  );
}
