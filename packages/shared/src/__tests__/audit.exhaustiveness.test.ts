import { describe, expect, it } from "vitest";
import {
  ACTOR_TYPES,
  AUDIT_EVENTS,
  BUFFERABLE_EVENTS,
  CRITICAL_EVENTS,
  TARGET_TYPES,
} from "../audit";

describe("A1.10 audit constants", () => {
  it("includes GLOBAL_ADMIN actor type", () => {
    expect(ACTOR_TYPES.GLOBAL_ADMIN).toBe("global_admin");
  });

  it("includes new target types", () => {
    expect(TARGET_TYPES.HOSTNAME).toBe("hostname");
    expect(TARGET_TYPES.SSO_PROVIDER).toBe("sso_provider");
    expect(TARGET_TYPES.ORGANIZATION).toBe("organization");
    expect(TARGET_TYPES.TENANT).toBe("tenant");
  });

  it("every AUDIT_EVENTS entry carries a 'kind' field of 'critical' or 'bufferable'", () => {
    // The TypeScript `satisfies Record<...>` check on AUDIT_EVENTS already
    // enforces this at compile time; this runtime guard catches accidental
    // drift in case someone bypasses types via casting.
    const allEntries = Object.values(AUDIT_EVENTS).flatMap((group) =>
      Object.values(group)
    );
    for (const entry of allEntries) {
      expect(entry.kind === "critical" || entry.kind === "bufferable").toBe(
        true
      );
    }
  });

  it("derives CRITICAL_EVENTS and BUFFERABLE_EVENTS as a complete, disjoint partition of AUDIT_EVENTS", () => {
    const allEvents = Object.values(AUDIT_EVENTS)
      .flatMap((group) =>
        Object.values(group as Record<string, { event: string }>)
      )
      .map((e) => e.event);

    const critSet = new Set<string>(CRITICAL_EVENTS);
    const bufSet = new Set<string>(BUFFERABLE_EVENTS);

    const missing = allEvents.filter((e) => !(critSet.has(e) || bufSet.has(e)));
    const overlap = allEvents.filter((e) => critSet.has(e) && bufSet.has(e));

    expect(missing, `Unclassified events: ${missing.join(", ")}`).toEqual([]);
    expect(overlap, `Overlapping events: ${overlap.join(", ")}`).toEqual([]);
    expect(critSet.size + bufSet.size).toBe(allEvents.length);
  });
});
