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
  { id: "active", label: "Active" },
  { id: "working", label: "Working" },
  { id: "snoozed", label: "Snoozed" },
  { id: "settled", label: "Settled" },
];

/** Only these columns accept a drop: dragging into Working or Snoozed is not
    supported anywhere in the app today, since a snooze needs a wake time and
    "working" reflects a live turn rather than something a user can set. */
export function boardColumnAcceptsDrop(from: SidebarSection, to: SidebarSection): boolean {
  return resolveSidebarDropVerb(from, to) !== null;
}

export { resolveSidebarDropVerb, type SidebarDropVerb, type SidebarSection };

/** Buckets every visible thread across every project into the same five
    sections the sidebar's stacked shelves use, so the board is the same
    model rendered as columns instead of a stacked list. */
export function groupThreadsForBoard(input: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>;
  readonly workingShelfEnabled: boolean;
  readonly now: string;
}): BoardColumns {
  const { threads, serverConfigs, workingShelfEnabled, now } = input;
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
    if (section === "active" && workingShelfEnabled && isSidebarThreadWorking(thread)) {
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
