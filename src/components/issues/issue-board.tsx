"use client";

import { useMemo, useState } from "react";
import {
  closestCorners,
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
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, GripVertical, MessageSquare, Plus } from "lucide-react";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { Issue, WorkflowState, WorkflowStateType } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { PriorityIcon, StateIcon, UserAvatar } from "./issue-glyphs";
import { buildIssueBoardColumns } from "./issue-board-model";

export function IssueBoard({
  issues,
  scopeTeamIds,
}: {
  issues: Issue[];
  scopeTeamIds?: string[];
}) {
  const { data, updateIssue, setSelectedIssueId, setCreateIssueOpen } = useWorkspace();
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const columns = useMemo(
    () => buildIssueBoardColumns(issues, data.states, scopeTeamIds),
    [data.states, issues, scopeTeamIds],
  );
  const activeIssue = data.issues.find((issue) => issue.id === activeIssueId);

  function handleDragStart(event: DragStartEvent) {
    setActiveIssueId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveIssueId(null);
    if (!event.over) return;
    const issueId = String(event.active.id);
    const statusId = String(event.over.data.current?.statusId ?? "");
    const statusType = event.over.data.current?.statusType as WorkflowStateType | undefined;
    const issue = data.issues.find((item) => item.id === issueId);
    if (!issue) return;
    const nextStatusId = statusId || data.states
      .filter((state) => state.teamId === issue.teamId && state.type === statusType)
      .toSorted((left, right) => left.position - right.position)[0]?.id;
    if (nextStatusId && issue.statusId !== nextStatusId) void updateIssue(issueId, { statusId: nextStatusId });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveIssueId(null)}
    >
      <div className="flex h-full min-h-[420px] gap-3 overflow-x-auto border-t border-border bg-background p-3" aria-label="Issue 看板">
        {columns.map((column) => {
          const columnIssues = issues.filter((issue) => column.stateIds.includes(issue.statusId));
          return (
            <BoardColumn
              key={column.id}
              columnId={column.id}
              label={column.label}
              state={column.state}
              statusId={column.statusId}
              statusType={column.statusType}
              issues={columnIssues}
              onOpen={setSelectedIssueId}
              onCreate={() => setCreateIssueOpen(true)}
            />
          );
        })}
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: "ease" }}>
        {activeIssue ? <IssueCard issue={activeIssue} state={data.states.find((state) => state.id === activeIssue.statusId)} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  columnId,
  label,
  state,
  statusId,
  statusType,
  issues,
  onOpen,
  onCreate,
}: {
  columnId: string;
  label: string;
  state: WorkflowState;
  statusId: string | null;
  statusType: WorkflowStateType | null;
  issues: Issue[];
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${columnId}`, data: { statusId, statusType } });

  return (
    <section ref={setNodeRef} className={cn("flex w-[292px] min-w-[292px] flex-col rounded-lg border border-border bg-surface-subtle/70 transition-colors", isOver && "border-accent bg-accent-soft")}>
      <header className="flex h-10 items-center gap-2 px-3 text-xs font-medium">
        <StateIcon state={state} size={14} />
        <span>{label}</span>
        <span className="text-tertiary">{issues.length}</span>
        <button type="button" onClick={onCreate} className="ml-auto grid size-7 place-items-center rounded text-tertiary transition-colors hover:bg-surface-hover hover:text-primary" aria-label={`在 ${label} 中新建`}>
          <Plus size={14} />
        </button>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {issues.map((issue) => (
          <DraggableIssueCard key={issue.id} issue={issue} state={state} onOpen={() => onOpen(issue.id)} />
        ))}
        {issues.length === 0 ? (
          <button type="button" onClick={onCreate} className="grid h-20 place-items-center rounded-md border border-dashed border-border text-xs text-tertiary transition-colors hover:border-border-strong hover:bg-surface-hover">
            添加 Issue
          </button>
        ) : null}
      </div>
    </section>
  );
}

function DraggableIssueCard({ issue, state, onOpen }: { issue: Issue; state: WorkflowState; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: issue.id, data: { statusId: state.id } });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform) }} className={cn(isDragging && "opacity-25")} {...attributes}>
      <IssueCard issue={issue} state={state} onOpen={onOpen} dragListeners={listeners} />
    </div>
  );
}

function IssueCard({
  issue,
  state,
  onOpen,
  dragListeners,
  overlay = false,
}: {
  issue: Issue;
  state: WorkflowState | undefined;
  onOpen?: () => void;
  dragListeners?: Record<string, unknown>;
  overlay?: boolean;
}) {
  const { data } = useWorkspace();
  const assignee = data.memberships.find((item) => item.userId === issue.assigneeId)?.user;
  const labels = data.labels.filter((label) => issue.labelIds.includes(label.id));
  const comments = data.comments.filter((comment) => comment.issueId === issue.id).length;
  return (
    <article className={cn("group rounded-md border border-border bg-surface p-3 shadow-[0_1px_2px_rgb(0_0_0_/_5%)] transition-colors hover:border-border-strong", overlay && "w-[292px] rotate-[1deg] shadow-[var(--shadow-popover)]")}>
      <div className="mb-2 flex items-center gap-1.5">
        <button type="button" className="-ml-1 grid size-6 touch-none place-items-center rounded text-tertiary opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" aria-label="拖动 Issue" {...dragListeners}>
          <GripVertical size={13} />
        </button>
        <StateIcon state={state} size={13} />
        <span className="font-mono text-[10px] text-tertiary">{issue.identifier}</span>
        <PriorityIcon priority={issue.priority} size={13} className="ml-auto" />
      </div>
      <button type="button" onClick={onOpen} className="block w-full text-left text-[13px] font-medium leading-5 outline-none">
        {issue.title}
      </button>
      {labels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {labels.slice(0, 3).map((label) => (
            <span key={label.id} className="inline-flex max-w-[120px] items-center gap-1 truncate rounded border border-border bg-surface-subtle px-1.5 py-0.5 text-[10px] text-secondary">
              <span className="size-1.5 rounded-full" style={{ background: label.color }} /> {label.name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex items-center gap-2 text-[10px] text-tertiary">
        {comments > 0 ? <span className="inline-flex items-center gap-1"><MessageSquare size={11} />{comments}</span> : null}
        {issue.dueDate ? <span className="inline-flex items-center gap-1"><CalendarDays size={11} />{formatDistanceToNowStrict(parseISO(issue.dueDate), { addSuffix: true, locale: zhCN })}</span> : null}
        <UserAvatar user={assignee} size={19} className="ml-auto" />
      </div>
    </article>
  );
}
