import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDate } from "@/lib/utils";
import { Pagination } from "@/modules/common/pagination";
import { Input } from "@/modules/ui/input";
import { Label } from "@/modules/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/modules/ui/table";
import { auditLogListQueryOptions, auditLogPageSize } from "./query";

interface AuditLogsPageProps {
  event?: string;
  onChange: (
    next: Partial<{ page: number; event: string; organizationId: string }>
  ) => void;
  organizationId?: string;
  page: number;
}

const FILTER_DEBOUNCE_MS = 300;

export function AuditLogsPage({
  page,
  event,
  organizationId,
  onChange,
}: AuditLogsPageProps) {
  const logs = useQuery(
    auditLogListQueryOptions({ page, event, organizationId })
  );

  const [eventInput, setEventInput] = useState(event ?? "");
  const [orgInput, setOrgInput] = useState(organizationId ?? "");
  const debouncedEvent = useDebouncedValue(eventInput, FILTER_DEBOUNCE_MS);
  const debouncedOrg = useDebouncedValue(orgInput, FILTER_DEBOUNCE_MS);

  // Avoid navigating on mount or when upstream prop drives local state.
  const lastSentEvent = useRef(event ?? "");
  const lastSentOrg = useRef(organizationId ?? "");

  useEffect(() => {
    if (debouncedEvent !== lastSentEvent.current) {
      lastSentEvent.current = debouncedEvent;
      onChange({ event: debouncedEvent, page: 1 });
    }
  }, [debouncedEvent, onChange]);

  useEffect(() => {
    if (debouncedOrg !== lastSentOrg.current) {
      lastSentOrg.current = debouncedOrg;
      onChange({ organizationId: debouncedOrg, page: 1 });
    }
  }, [debouncedOrg, onChange]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-2xl">Audit logs</h2>
        <p className="text-muted-foreground text-sm">
          Cross-tenant operator audit trail.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="event-filter">Event</Label>
          <Input
            id="event-filter"
            onChange={(e) => setEventInput(e.target.value)}
            placeholder="e.g. tenant.suspend"
            value={eventInput}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="org-filter">Tenant</Label>
          <Input
            id="org-filter"
            onChange={(e) => setOrgInput(e.target.value)}
            placeholder="organization id"
            value={orgInput}
          />
        </div>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.isLoading ? (
              <TableRow>
                <TableCell colSpan={4}>Loading…</TableCell>
              </TableRow>
            ) : null}
            {!logs.isLoading && (logs.data?.data.length ?? 0) === 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={4}>
                  No audit log entries.
                </TableCell>
              </TableRow>
            ) : null}
            {logs.data?.data.map((log) => (
              <TableRow key={log.id}>
                <TableCell>{formatDate(log.occurredAt)}</TableCell>
                <TableCell>{log.actorEmail ?? log.actorId ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{log.event}</TableCell>
                <TableCell className="font-mono text-xs">
                  {log.targetType ? `${log.targetType}:` : ""}
                  {log.targetId ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {logs.data ? (
        <Pagination
          onPageChange={(next) => onChange({ page: next })}
          page={page}
          pageSize={auditLogPageSize}
          total={logs.data.meta.total}
        />
      ) : null}
    </div>
  );
}
