import { describe, expect, it } from "vitest";
import { EnvironmentId, ThreadId, type ServerConfig } from "@t3tools/contracts";

import { makeThreadFixture } from "../test-fixtures";
import { boardColumnAcceptsDrop, groupThreadsForBoard, resolveBoardDropVerb } from "./Board.logic";

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
  it("buckets threads into pinned, needs-you (active), snoozed and settled by priority", () => {
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
    const needsYou = makeThreadFixture({
      id: ThreadId.make("needs-you"),
      hasPendingApprovals: true,
    });
    // Snoozed outranks pinned and settled: a thread can be pinned AND snoozed,
    // and the snooze shelf wins until it wakes.
    const snoozedAndPinned = makeThreadFixture({
      id: ThreadId.make("snoozed-and-pinned"),
      pinnedAt: NOW,
      snoozedAt: NOW,
      snoozedUntil: "2026-01-16T00:00:00.000Z",
    });

    const columns = groupThreadsForBoard({
      threads: [pinned, settled, snoozed, needsYou, snoozedAndPinned],
      serverConfigs: SERVER_CONFIGS,
      now: NOW,
    });

    expect(columns.pinned.map((t) => t.id)).toEqual(["pinned"]);
    expect(columns.settled.map((t) => t.id)).toEqual(["settled"]);
    expect(columns.snoozed.map((t) => t.id).toSorted()).toEqual(
      ["snoozed", "snoozed-and-pinned"].toSorted(),
    );
    expect(columns.active.map((t) => t.id)).toEqual(["needs-you"]);
    expect(columns.working).toEqual([]);
  });

  it("excludes archived threads", () => {
    const archived = makeThreadFixture({ id: ThreadId.make("archived"), archivedAt: NOW });
    const columns = groupThreadsForBoard({
      threads: [archived],
      serverConfigs: SERVER_CONFIGS,
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
      now: NOW,
    });
    expect(columns.settled).toEqual([]);
    expect(columns.active.map((t) => t.id)).toEqual(["settled"]);
  });

  it("always splits Needs You from Working, independent of the sidebar's working-shelf setting", () => {
    const working = makeThreadFixture({
      id: ThreadId.make("working"),
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      runtime: { status: "running" } as never,
    });
    const needsYou = makeThreadFixture({
      id: ThreadId.make("needs-you"),
      hasPendingApprovals: true,
    });

    const columns = groupThreadsForBoard({
      threads: [working, needsYou],
      serverConfigs: SERVER_CONFIGS,
      now: NOW,
    });

    expect(columns.working.map((t) => t.id)).toEqual(["working"]);
    expect(columns.active.map((t) => t.id)).toEqual(["needs-you"]);
  });
});

describe("resolveBoardDropVerb", () => {
  it("lets a Working card move to Pinned or Settled", () => {
    expect(resolveBoardDropVerb("working", "pinned")).toBe("pin");
    expect(resolveBoardDropVerb("working", "settled")).toBe("settle");
  });

  it("does not let a Working card move into Needs You: that column is derived, not settable", () => {
    expect(resolveBoardDropVerb("working", "active")).toBeNull();
  });

  it("still lets a Needs You (active) card move to Pinned or Settled", () => {
    expect(resolveBoardDropVerb("active", "pinned")).toBe("pin");
    expect(resolveBoardDropVerb("active", "settled")).toBe("settle");
  });
});

describe("boardColumnAcceptsDrop", () => {
  it("accepts drops into pinned, needs-you (active) and settled", () => {
    expect(boardColumnAcceptsDrop("active", "pinned")).toBe(true);
    expect(boardColumnAcceptsDrop("pinned", "active")).toBe(true);
    expect(boardColumnAcceptsDrop("active", "settled")).toBe(true);
    expect(boardColumnAcceptsDrop("snoozed", "active")).toBe(true);
    expect(boardColumnAcceptsDrop("working", "pinned")).toBe(true);
    expect(boardColumnAcceptsDrop("working", "settled")).toBe(true);
  });

  it("rejects drops into working or snoozed, a Working card into Needs You, and drops onto the same column", () => {
    expect(boardColumnAcceptsDrop("active", "working")).toBe(false);
    expect(boardColumnAcceptsDrop("active", "snoozed")).toBe(false);
    expect(boardColumnAcceptsDrop("active", "active")).toBe(false);
    expect(boardColumnAcceptsDrop("working", "active")).toBe(false);
  });
});
