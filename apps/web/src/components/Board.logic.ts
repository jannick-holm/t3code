import type { EnvironmentId, ServerConfig } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";

import {
  filterSidebarV2VisibleThreads,
  firstValidTimestampMs,
  isSidebarThreadWorking,
  resolveSidebarDropVerb,
  resolveSidebarThreadSection,
  sortPinnedThreadsForSidebar,
  sortThreadsForSidebar,
  sortWorkingThreadsBySend,
  type SidebarDropVerb,
  type SidebarSection,
} from "./Sidebar.logic";

export type BoardColumns = Record<SidebarSection, readonly EnvironmentThreadShell[]>;

export const BOARD_COLUMN_ORDER: ReadonlyArray<{
  readonly id: SidebarSection;
  readonly label: string;
}> = [
  { id: "pinned", label: "Pinned" },
  { id: "active", label: "Needs You" },
  { id: "working", label: "Working" },
  { id: "snoozed", label: "Snoozed" },
  { id: "settled", label: "Settled" },
];

/** Dragging into Working or Snoozed is not supported: a snooze needs a wake
    time a drop can't carry, and "working" reflects a live turn rather than
    something a user can set. A Working card CAN be dragged out (to Pinned or
    Settled, same as a Needs You card), but not sideways into Needs You —
    that column is a derived state (a pending approval or question), not
    something dropping a card there can create. */
export function resolveBoardDropVerb(
  from: SidebarSection,
  to: SidebarSection,
): SidebarDropVerb | null {
  if (from === "working" && to === "active") return null;
  return resolveSidebarDropVerb(from, to);
}

export function boardColumnAcceptsDrop(from: SidebarSection, to: SidebarSection): boolean {
  return resolveBoardDropVerb(from, to) !== null;
}

export { type SidebarDropVerb, type SidebarSection };

/** Buckets every visible thread across every project into the sidebar's five
    sections, splitting Active into Needs You (waiting on the user) and
    Working (running with nothing for the user to do) unconditionally — the
    board always shows both, regardless of the sidebar's own working-shelf
    beta setting. */
export function groupThreadsForBoard(input: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>;
  readonly now: string;
}): BoardColumns {
  const { threads, serverConfigs, now } = input;
  const pinned: EnvironmentThreadShell[] = [];
  const active: EnvironmentThreadShell[] = [];
  const working: EnvironmentThreadShell[] = [];
  const snoozed: EnvironmentThreadShell[] = [];
  const settled: EnvironmentThreadShell[] = [];

  for (const thread of filterSidebarV2VisibleThreads(threads, null)) {
    const capabilities = serverConfigs.get(thread.environmentId)?.environment.capabilities;
    const isSnoozed = capabilities?.threadSnooze === true && effectiveSnoozed(thread, { now });
    const isSettled =
      capabilities?.threadSettlement === true && thread.settledOverride === "settled";
    const isPinned = thread.pinnedAt != null;
    const section = resolveSidebarThreadSection({
      snoozed: isSnoozed,
      settled: isSettled,
      pinned: isPinned,
    });
    if (section === "active" && isSidebarThreadWorking(thread)) {
      working.push(thread);
      continue;
    }
    (section === "pinned"
      ? pinned
      : section === "settled"
        ? settled
        : section === "snoozed"
          ? snoozed
          : active
    ).push(thread);
  }

  return {
    pinned: sortPinnedThreadsForSidebar(pinned),
    active: sortThreadsForSidebar(active),
    working: sortWorkingThreadsBySend(working),
    snoozed: snoozed.toSorted(
      (left, right) =>
        firstValidTimestampMs(left.snoozedUntil) - firstValidTimestampMs(right.snoozedUntil),
    ),
    settled: sortSettledThreads(settled),
  };
}
