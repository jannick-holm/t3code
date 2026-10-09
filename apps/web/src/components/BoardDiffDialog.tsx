import { FileDiff } from "@pierre/diffs/react";
import { useMemo } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { useThreadProjection } from "../state/entities";
import { useTheme } from "../hooks/useTheme";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { useCheckpointDiff } from "../lib/checkpointDiffState";
import {
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "../lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "../lib/syntaxHighlighting";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";
import { DiffStatLabel, hasNonZeroStat } from "./chat/DiffStatLabel";
import { summarizeTurnDiffStats } from "../lib/turnDiffTree";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Spinner } from "./ui/spinner";

export function BoardDiffDialog(props: {
  threadRef: ScopedThreadRef | null;
  threadTitle: string | null;
  onOpenChange: (open: boolean) => void;
  onOpenFullThread: (ref: ScopedThreadRef) => void;
}) {
  const { threadRef, threadTitle, onOpenChange, onOpenFullThread } = props;
  const { resolvedTheme } = useTheme();
  const projection = useThreadProjection(threadRef)?.projection ?? null;
  const { turnDiffSummaries } = useTurnDiffSummaries(projection);

  const latestReady = useMemo(
    () =>
      turnDiffSummaries
        .filter((checkpoint) => checkpoint.status === "ready")
        .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
        .at(-1) ?? null,
    [turnDiffSummaries],
  );

  const diffState = useCheckpointDiff(
    {
      environmentId: threadRef?.environmentId ?? null,
      threadId: threadRef?.threadId ?? null,
      fromTurnCount: 0,
      toTurnCount: latestReady?.checkpointTurnCount ?? null,
      ignoreWhitespace: false,
    },
    { enabled: latestReady !== null },
  );

  const renderablePatch = getRenderablePatch(diffState.data?.diff, "board-diff-dialog");
  const summaryStat = latestReady ? summarizeTurnDiffStats(latestReady.files) : null;

  return (
    <Dialog open={threadRef !== null} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate">{threadTitle ?? "Thread changes"}</span>
              {summaryStat && hasNonZeroStat(summaryStat) ? (
                <DiffStatLabel
                  additions={summaryStat.additions}
                  deletions={summaryStat.deletions}
                  layout="inline"
                  className="shrink-0 text-xs"
                />
              ) : null}
            </div>
          </DialogTitle>
        </DialogHeader>
        <DialogPanel className="max-h-[70vh]">
          {latestReady === null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No changes yet.</p>
          ) : diffState.isPending ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="size-5" />
            </div>
          ) : renderablePatch === null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No changes yet.</p>
          ) : renderablePatch.kind === "raw" ? (
            <pre className="overflow-x-auto rounded-md bg-muted/40 p-2 text-xs">
              {renderablePatch.text}
            </pre>
          ) : (
            <DiffWorkerPoolProvider>
              <div className="flex flex-col gap-3">
                {renderablePatch.files.map((fileDiff) => (
                  <FileDiff
                    key={resolveFileDiffPath(fileDiff)}
                    fileDiff={fileDiff}
                    options={{
                      collapsed: false,
                      diffStyle: "unified",
                      theme: resolveDiffThemeName(resolvedTheme),
                      preferredHighlighter: PREFERRED_HIGHLIGHTER,
                    }}
                  />
                ))}
              </div>
            </DiffWorkerPoolProvider>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (threadRef) onOpenFullThread(threadRef);
            }}
          >
            Open full thread
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
