import { describe, expect, it } from "vitest";
import { EnvironmentId, ThreadId, type ServerConfig } from "@t3tools/contracts";

import { makeThreadFixture } from "../test-fixtures";
import { boardColumnAcceptsDrop, groupThreadsForBoard } from "./Board.logic";

const ENVIRONMENT_ID = EnvironmentId.make("environment-test");
const NOW = "2026-01-15T12:00:00.000Z";

const SERVER_CONFIGS = new Map([
  [
    ENVIRONMENT_ID,
    {
      environment: { capabilities: { threadSnooze: true, threadSettlement: true } },
    } as unknown as ServerConfig,
  ],
]);

describe("groupThreadsForBoard", () => {
  it("buckets threads into pinned, active, snoozed and settled by priority", () => {
    const pinned = makeThreadFixture({ id: ThreadId.make("pinned"), pinnedAt: NOW });
    const settled = makeThreadFixture({
      id: ThreadId.make("settled"),
      settledOverride: "settled",
    });
    const snoozed = makeThreadFixture({
      id: ThreadId.make("snoozed"),
      snoozedAt: NOW,
      snoozedUntil: "2026-01-16T00:00:00.000Z",
    });
    const active = makeThreadFixture({ id: ThreadId.make("active") });
    // Snoozed outranks pinned and settled: a thread can be pinned AND snoozed,
    // and the snooze shelf wins until it wakes.
    const snoozedAndPinned = makeThreadFixture({
      id: ThreadId.make("snoozed-and-pinned"),
      pinnedAt: NOW,
      snoozedAt: NOW,
      snoozedUntil: "2026-01-16T00:00:00.000Z",
    });

    const columns = groupThreadsForBoard({
      threads: [pinned, settled, snoozed, active, snoozedAndPinned],
      serverConfigs: SERVER_CONFIGS,
      workingShelfEnabled: false,
      now: NOW,
    });

    expect(columns.pinned.map((t) => t.id)).toEqual(["pinned"]);
    expect(columns.settled.map((t) => t.id)).toEqual(["settled"]);
    expect(columns.snoozed.map((t) => t.id).toSorted()).toEqual(
      ["snoozed", "snoozed-and-pinned"].toSorted(),
    );
    expect(columns.active.map((t) => t.id)).toEqual(["active"]);
    expect(columns.working).toEqual([]);
  });

  it("excludes archived threads", () => {
    const archived = makeThreadFixture({ id: ThreadId.make("archived"), archivedAt: NOW });
    const columns = groupThreadsForBoard({
      threads: [archived],
      serverConfigs: SERVER_CONFIGS,
      workingShelfEnabled: false,
      now: NOW,
    });
    expect(Object.values(columns).flat()).toEqual([]);
  });

  it("ignores snooze and settlement when the server lacks the capability", () => {
    const noCapabilityEnvironment = EnvironmentId.make("environment-no-capabilities");
    const settled = makeThreadFixture({
      id: ThreadId.make("settled"),
      environmentId: noCapabilityEnvironment,
      settledOverride: "settled",
    });
    const columns = groupThreadsForBoard({
      threads: [settled],
      serverConfigs: SERVER_CONFIGS,
      workingShelfEnabled: false,
      now: NOW,
    });
    expect(columns.settled).toEqual([]);
    expect(columns.active.map((t) => t.id)).toEqual(["settled"]);
  });

  it("folds non-attention-needing active threads into Working when the beta is on", () => {
    const working = makeThreadFixture({
      id: ThreadId.make("working"),
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      runtime: { status: "running" } as never,
    });
    const needsAttention = makeThreadFixture({
      id: ThreadId.make("needs-attention"),
      hasPendingApprovals: true,
    });

    const columns = groupThreadsForBoard({
      threads: [working, needsAttention],
      serverConfigs: SERVER_CONFIGS,
      workingShelfEnabled: true,
      now: NOW,
    });

    expect(columns.working.map((t) => t.id)).toEqual(["working"]);
    expect(columns.active.map((t) => t.id)).toEqual(["needs-attention"]);
  });
});

describe("boardColumnAcceptsDrop", () => {
  it("accepts drops into pinned, active and settled", () => {
    expect(boardColumnAcceptsDrop("active", "pinned")).toBe(true);
    expect(boardColumnAcceptsDrop("pinned", "active")).toBe(true);
    expect(boardColumnAcceptsDrop("active", "settled")).toBe(true);
    expect(boardColumnAcceptsDrop("snoozed", "active")).toBe(true);
  });

  it("rejects drops into working or snoozed, and drops onto the same column", () => {
    expect(boardColumnAcceptsDrop("active", "working")).toBe(false);
    expect(boardColumnAcceptsDrop("active", "snoozed")).toBe(false);
    expect(boardColumnAcceptsDrop("active", "active")).toBe(false);
  });
});
