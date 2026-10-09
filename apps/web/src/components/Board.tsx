import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

import { isElectron } from "../env";
import { useProjects, useServerConfigs, useThreadShells } from "../state/entities";
import { readEnvironmentScope } from "../state/session";
import { useClientSettings } from "../hooks/useSettings";
import { useNowMinute } from "../hooks/useNowMinute";
import { useThreadActions } from "../hooks/useThreadActions";
import { buildThreadRouteParams } from "../threadRoutes";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { cn } from "~/lib/utils";
import { BOARD_COLUMN_ORDER, boardColumnAcceptsDrop, groupThreadsForBoard } from "./Board.logic";
import { resolveSidebarDropVerb, type SidebarSection } from "./Sidebar.logic";
import { ProjectFavicon, type ProjectFaviconProject } from "./ProjectFavicon";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { SidebarInset } from "./ui/sidebar";
import { WorkspacePageHeader } from "./WorkspacePageHeader";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "./WorkspaceBreadcrumb";
import { ScrollArea } from "./ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

function checkThreadOperations(thread: Pick<EnvironmentThreadShell, "environmentId">): boolean {
  if (readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope)) return true;
  toastManager.add({
    type: "error",
    title: "Thread action unavailable",
    description: "This connection cannot change this thread.",
  });
  return false;
}

function BoardCardBody(props: {
  thread: EnvironmentThreadShell;
  project: ProjectFaviconProject | null;
}) {
  const { thread, project } = props;
  const needsAttention = thread.hasPendingApprovals || thread.hasPendingUserInput;
  return (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {project ? (
          <>
            <ProjectFavicon project={project} className="size-3.5 shrink-0" />
            <span className="truncate">{project.title}</span>
          </>
        ) : null}
        {needsAttention ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  aria-label="Needs attention"
                  className="ml-auto size-1.5 shrink-0 rounded-full bg-warning"
                />
              }
            />
            <TooltipPopup side="top">Needs attention</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <p className="line-clamp-2 font-medium">{thread.title}</p>
      <p className="text-xs text-muted-foreground">{formatRelativeTimeLabel(thread.updatedAt)}</p>
    </>
  );
}

function BoardCard(props: {
  thread: EnvironmentThreadShell;
  project: ProjectFaviconProject | null;
  onSelect: () => void;
}) {
  const { thread, project, onSelect } = props;
  const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: key });
  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5 text-sm shadow-xs hover:bg-accent/40",
        isDragging && "opacity-40",
      )}
    >
      <BoardCardBody thread={thread} project={project} />
    </li>
  );
}

function BoardColumnView(props: {
  id: SidebarSection;
  label: string;
  threads: readonly EnvironmentThreadShell[];
  projectByKey: ReadonlyMap<string, ProjectFaviconProject>;
  draggingSection: SidebarSection | null;
  onSelectThread: (ref: ScopedThreadRef) => void;
}) {
  const { id, label, threads, projectByKey, draggingSection, onSelectThread } = props;
  const canDrop = draggingSection !== null && boardColumnAcceptsDrop(draggingSection, id);
  const { setNodeRef, isOver } = useDroppable({
    id,
    disabled: draggingSection === null || !canDrop,
  });
  return (
    <div className="flex h-full w-72 shrink-0 flex-col rounded-lg bg-muted/30">
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground/60">{threads.length}</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul
          ref={setNodeRef}
          className={cn(
            "flex min-h-full flex-col gap-2 p-2 pt-0",
            draggingSection !== null && !canDrop && "opacity-50",
            isOver && canDrop && "outline outline-2 outline-primary/50",
          )}
        >
          {threads.map((thread) => (
            <BoardCard
              key={scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))}
              thread={thread}
              project={projectByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null}
              onSelect={() => onSelectThread(scopeThreadRef(thread.environmentId, thread.id))}
            />
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}

export function BoardPage() {
  const threads = useThreadShells();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const workingShelfEnabled = useClientSettings((s) => s.sidebarWorkingShelfEnabled);
  const now = useNowMinute();
  const router = useRouter();
  const { settleThread, unsettleThread, unsnoozeThread, pinThread, unpinThread } =
    useThreadActions();
  const inFlightKeysRef = useRef<Set<string>>(new Set());
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const columns = useMemo(
    () => groupThreadsForBoard({ threads, serverConfigs, workingShelfEnabled, now }),
    [threads, serverConfigs, workingShelfEnabled, now],
  );
  const threadByKey = useMemo(() => {
    const map = new Map<string, EnvironmentThreadShell>();
    for (const column of BOARD_COLUMN_ORDER) {
      for (const thread of columns[column.id]) {
        map.set(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread);
      }
    }
    return map;
  }, [columns]);
  const sectionByKey = useMemo(() => {
    const map = new Map<string, SidebarSection>();
    for (const column of BOARD_COLUMN_ORDER) {
      for (const thread of columns[column.id]) {
        map.set(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), column.id);
      }
    }
    return map;
  }, [columns]);
  const projectByKey = useMemo(() => {
    const map = new Map<string, ProjectFaviconProject>();
    for (const project of projects) {
      map.set(`${project.environmentId}:${project.id}`, project);
    }
    return map;
  }, [projects]);

  const navigateToThread = useCallback(
    (ref: ScopedThreadRef) => {
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(ref),
      });
    },
    [router],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggingKey(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingKey(null);
      const activeKey = String(event.active.id);
      const overId = event.over?.id;
      const fromSection = sectionByKey.get(activeKey);
      const thread = threadByKey.get(activeKey);
      if (overId === undefined || fromSection === undefined || thread === undefined) return;
      const toSection = String(overId) as SidebarSection;
      const verb = resolveSidebarDropVerb(fromSection, toSection);
      if (verb === null) return;
      if (!checkThreadOperations(thread)) return;
      if (inFlightKeysRef.current.has(activeKey)) return;
      inFlightKeysRef.current.add(activeKey);
      const threadRef = scopeThreadRef(thread.environmentId, thread.id);
      const action: Promise<AtomCommandResult<unknown, unknown>> =
        verb === "pin"
          ? pinThread(threadRef, {})
          : verb === "unpin"
            ? unpinThread(threadRef)
            : verb === "settle"
              ? settleThread(threadRef)
              : verb === "unsettle"
                ? unsettleThread(threadRef)
                : unsnoozeThread(threadRef);
      void action.then((result) => {
        inFlightKeysRef.current.delete(activeKey);
        if (result._tag !== "Success" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: `Failed to ${verb} thread`,
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      });
    },
    [
      sectionByKey,
      threadByKey,
      pinThread,
      unpinThread,
      settleThread,
      unsettleThread,
      unsnoozeThread,
    ],
  );

  const draggingSection = draggingKey === null ? null : (sectionByKey.get(draggingKey) ?? null);
  const draggingThread = draggingKey === null ? null : (threadByKey.get(draggingKey) ?? null);

  const visibleColumns = BOARD_COLUMN_ORDER.filter(
    (column) => column.id !== "working" || workingShelfEnabled,
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <WorkspaceBreadcrumb ariaLabel="Board breadcrumb">
            <WorkspaceBreadcrumbItem current>
              <h1>Board</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setDraggingKey(null)}
          >
            <div className="flex h-full min-w-fit gap-3 p-3">
              {visibleColumns.map((column) => (
                <BoardColumnView
                  key={column.id}
                  id={column.id}
                  label={column.label}
                  threads={columns[column.id]}
                  projectByKey={projectByKey}
                  draggingSection={draggingSection}
                  onSelectThread={navigateToThread}
                />
              ))}
            </div>
            <DragOverlay>
              {draggingThread ? (
                <div className="flex w-72 cursor-grabbing flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5 text-sm shadow-lg">
                  <BoardCardBody
                    thread={draggingThread}
                    project={
                      projectByKey.get(
                        `${draggingThread.environmentId}:${draggingThread.projectId}`,
                      ) ?? null
                    }
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>
    </SidebarInset>
  );
}
