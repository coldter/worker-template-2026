import { format, formatDistanceToNow } from "date-fns";
import { Check, Copy } from "lucide-react";
import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";
import { Badge } from "@/modules/ui/badge";
import { ScrollArea } from "@/modules/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/modules/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/ui/tooltip";

import { EventIcon } from "../event-icon";
import {
  encodeAuditLogMetadata,
  formatMetadataValue,
  getActorTypeLabel,
  getEventBadgeStyle,
  getEventDescription,
  getEventDisplayName,
  getTargetTypeLabel,
} from "../event-utils";
import type { AuditLogMetadata, AuditLogMetadataValue } from "../event-utils";
import type { AuditLog } from "../table/columns";

interface AuditLogDetailSheetProps {
  log: AuditLog | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FIELD_NAME_LEADING_CHAR_REGEX = /^\w/u;

const formatFieldName = (name: string): string =>
  name
    .replaceAll(/(?<letter>[A-Z])/gu, " $<letter>")
    .replaceAll(/[_-]/gu, " ")
    .replace(FIELD_NAME_LEADING_CHAR_REGEX, (c) => c.toUpperCase())
    .trim();

const CopyableValue = ({ value, label }: { value: string; label?: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [value]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className="text-foreground inline-flex items-center gap-1 rounded-md font-mono text-xs transition-colors hover:text-blue-600 dark:hover:text-blue-400"
          onClick={handleCopy}
          type="button"
        >
          <span className="max-w-[200px] truncate">{value}</span>
          {copied ? (
            <Check className="size-3 shrink-0 text-emerald-500" />
          ) : (
            <Copy className="text-muted-foreground size-3 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {copied ? "Copied!" : `Copy ${label ?? "value"}`}
      </TooltipContent>
    </Tooltip>
  );
};

const DetailRow = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="group/row flex items-start justify-between gap-4 py-2.5">
    <span className="text-muted-foreground shrink-0 text-sm">{label}</span>
    <div className="text-right text-sm">{children}</div>
  </div>
);

const MetadataValue = ({ data }: { data: AuditLogMetadataValue }) => {
  if (data.kind === "null") {
    return <span className="text-muted-foreground italic">None</span>;
  }

  if (
    data.kind === "string" ||
    data.kind === "number" ||
    data.kind === "boolean"
  ) {
    return <span className="font-mono text-xs">{String(data.value)}</span>;
  }

  if (data.kind === "array") {
    if (data.items.length === 0) {
      return <span className="text-muted-foreground italic">Empty</span>;
    }

    return (
      <div className="flex flex-wrap justify-end gap-1">
        {data.items.map((item, idx) => (
          <Badge
            className="font-mono text-[10px]"
            key={`${formatMetadataValue(item)}-${idx}`}
            variant="secondary"
          >
            {formatMetadataValue(item)}
          </Badge>
        ))}
      </div>
    );
  }

  const { from, to } = data.fields;

  if (from === undefined || to === undefined) {
    return null;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[10px]">from</span>
        <MetadataValue data={from} />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
          to
        </span>
        <MetadataValue data={to} />
      </div>
    </div>
  );
};

const MetadataSection = ({ metadata }: { metadata: AuditLogMetadata }) => {
  const entries = Object.entries(metadata);

  const { changes, changedFields } = metadata;

  const otherEntries = entries.filter(
    ([key]) => key !== "changes" && key !== "changedFields"
  );

  const changeEntries =
    changes?.kind === "object" ? Object.entries(changes.fields) : [];

  const changedFieldCount =
    changedFields?.kind === "array" ? changedFields.items.length : null;

  return (
    <div className="space-y-3">
      {otherEntries.map(([key, value]) => {
        if (value.kind === "object") {
          return null;
        }

        return (
          <DetailRow key={key} label={formatFieldName(key)}>
            <MetadataValue data={value} />
          </DetailRow>
        );
      })}

      {changes?.kind === "object" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 pt-1">
            <span className="text-sm font-medium">Changes</span>
            {changedFieldCount !== null && (
              <span className="text-muted-foreground text-xs">
                ({changedFieldCount} field
                {changedFieldCount === 1 ? "" : "s"})
              </span>
            )}
          </div>
          <div className="bg-muted/50 space-y-0 divide-y rounded-lg border p-0">
            {changeEntries.map(([field, change]) => (
              <div
                className="flex items-start justify-between gap-4 px-3 py-2.5"
                key={field}
              >
                <code className="shrink-0 text-xs font-medium">{field}</code>
                <MetadataValue data={change} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const parseUserAgent = (ua: string) => {
  let browser = "Unknown";
  let os = "Unknown";

  if (ua.includes("Windows")) {
    os = "Windows";
  } else if (ua.includes("Mac OS X") || ua.includes("Macintosh")) {
    os = "macOS";
  } else if (ua.includes("Linux") && !ua.includes("Android")) {
    os = "Linux";
  } else if (ua.includes("Android")) {
    os = "Android";
  } else if (ua.includes("iPhone") || ua.includes("iPad")) {
    os = "iOS";
  }

  if (ua.includes("FakerBot")) {
    browser = "FakerBot";
  } else if (ua.includes("Googlebot")) {
    browser = "Googlebot";
  } else if (ua.includes("Edg/")) {
    browser = "Edge";
  } else if (ua.includes("Chrome/")) {
    browser = "Chrome";
  } else if (ua.includes("Firefox/")) {
    browser = "Firefox";
  } else if (ua.includes("Safari/") && !ua.includes("Chrome")) {
    browser = "Safari";
  }

  return { browser, os };
};

export const AuditLogDetailSheet = ({
  log,
  open,
  onOpenChange,
}: AuditLogDetailSheetProps) => {
  if (!log) {
    return null;
  }

  const style = getEventBadgeStyle(log.event);
  const dateObj = new Date(log.createdAt);
  const uaInfo = log.userAgent ? parseUserAgent(log.userAgent) : null;

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="flex flex-col p-0 sm:max-w-[480px]" side="right">
        <SheetHeader className="border-b px-6 pt-6 pb-4">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl",
                style.className
              )}
            >
              <EventIcon className="size-5" event={log.event} />
            </span>
            <div className="space-y-1">
              <SheetTitle className="flex items-center gap-2 text-base leading-tight">
                {getEventDisplayName(log.event)}
              </SheetTitle>
              <SheetDescription className="text-xs leading-relaxed">
                {getEventDescription(log.event, log.actorType, log.metadata)}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 overflow-hidden">
          <div className="flex max-w-full flex-col divide-y px-6">
            <div className="py-4">
              <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
                Event Information
              </h3>
              <DetailRow label="Event">
                <Badge
                  className={cn("font-mono text-[11px]", style.className)}
                  variant="outline"
                >
                  {log.event}
                </Badge>
              </DetailRow>
              <DetailRow label="Log ID">
                <CopyableValue label="log ID" value={log.id} />
              </DetailRow>
              <DetailRow label="Timestamp">
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-xs font-medium">
                    {format(dateObj, "PPpp")}
                  </span>
                  <span className="text-muted-foreground text-[10px]">
                    {formatDistanceToNow(dateObj, { addSuffix: true })}
                  </span>
                </div>
              </DetailRow>
            </div>

            <div className="py-4">
              <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
                Actor
              </h3>
              <DetailRow label="Type">
                <Badge className="text-[11px]" variant="secondary">
                  {getActorTypeLabel(log.actorType)}
                </Badge>
              </DetailRow>
              <DetailRow label="Actor ID">
                {log.actorId ? (
                  <CopyableValue label="actor ID" value={log.actorId} />
                ) : (
                  <span className="text-muted-foreground text-xs italic">
                    None
                  </span>
                )}
              </DetailRow>
            </div>

            <div className="py-4">
              <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
                Target
              </h3>
              <DetailRow label="Type">
                {log.targetType ? (
                  <Badge className="text-[11px]" variant="secondary">
                    {getTargetTypeLabel(log.targetType)}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-xs italic">
                    None
                  </span>
                )}
              </DetailRow>
              <DetailRow label="Target ID">
                {log.targetId ? (
                  <CopyableValue label="target ID" value={log.targetId} />
                ) : (
                  <span className="text-muted-foreground text-xs italic">
                    None
                  </span>
                )}
              </DetailRow>
            </div>

            <div className="py-4">
              <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
                Network
              </h3>
              <DetailRow label="IP Address">
                {log.ipAddress ? (
                  <CopyableValue label="IP address" value={log.ipAddress} />
                ) : (
                  <span className="text-muted-foreground text-xs italic">
                    None
                  </span>
                )}
              </DetailRow>
              {uaInfo && (
                <>
                  <DetailRow label="Browser">
                    <span className="text-xs">{uaInfo.browser}</span>
                  </DetailRow>
                  <DetailRow label="OS">
                    <span className="text-xs">{uaInfo.os}</span>
                  </DetailRow>
                </>
              )}
              {log.userAgent && (
                <DetailRow label="User Agent">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-muted-foreground max-w-[200px] cursor-help truncate font-mono text-[10px]">
                        {log.userAgent.slice(0, 40)}...
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <span className="font-mono text-[10px] break-all">
                        {log.userAgent}
                      </span>
                    </TooltipContent>
                  </Tooltip>
                </DetailRow>
              )}
            </div>

            {log.metadata && Object.keys(log.metadata).length > 0 && (
              <div className="py-4">
                <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
                  Metadata
                </h3>
                <MetadataSection metadata={log.metadata} />
              </div>
            )}

            <div className="w-full max-w-full py-4 pb-6">
              <details className="group w-full max-w-full">
                <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none text-xs font-semibold tracking-wider uppercase transition-colors outline-none select-none [&::-webkit-details-marker]:hidden">
                  <div className="focus-visible:ring-ring flex w-fit items-center gap-1.5 rounded-sm outline-none group-open:mb-3 focus-visible:ring-2">
                    <span className="inline-flex size-4 items-center justify-center text-[10px] transition-transform group-open:rotate-90">
                      &#9654;
                    </span>
                    Raw JSON
                  </div>
                </summary>
                <div className="relative w-full">
                  <pre className="bg-muted w-full max-w-full scrollbar-thin overflow-x-auto rounded-lg border p-3.5 font-mono text-[11px] leading-relaxed">
                    {JSON.stringify(
                      {
                        ...log,
                        metadata:
                          log.metadata === null
                            ? null
                            : encodeAuditLogMetadata(log.metadata),
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>
              </details>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
