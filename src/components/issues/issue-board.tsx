"use client";

import { useMemo, useState } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, GripVertical, LoaderCircle, MessageSquare, Plus } from "lucide-react";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { Issue, WorkflowState, WorkflowStateType } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { getIssueStatusTransitionChanges } from "@/modules/issues/logic";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { PriorityIcon, StateIcon, UserAvatar } from "./issue-glyphs";
import {
  buildIssueBoardColumns,
  calculateIssueSortOrder,
  resolveIssueBoardStatus,
} from "./issue-board-model";

const announcements: Announcements = {
  onDragStart({ active }) {
    return `已拿起 ${String(active.data.current?.identifier ?? "Issue")}。使用方向键选择状态，按空格键放下。`;
  },
  onDragOver({ active, over }) {
    if (!over) return `${String(active.data.current?.identifier ?? "Issue")} 当前没有可用落点。`;
    return `${String(active.data.current?.identifier ?? "Issue")} 位于 ${String(over.data.current?.label ?? "目标状态")} 上方。`;
  },
  onDragEnd({ active, over }) {
    if (!over) return `${String(active.data.current?.identifier ?? "Issue")} 未移动。`;
    return `${String(active.data.current?.identifier ?? "Issue")} 已放到 ${String(over.data.current?.label ?? "目标状态")}。`;
  },
  onDragCancel({ active }) {
    return `已取消移动 ${String(active.data.current?.identifier ?? "Issue")}。`;
  },
};

function isAfterOver(event: DragEndEvent): boolean {
  const translated = event.active.rect.current.translated;
  if (!translated || !event.over) return false;
  const activeCenter = translated.top + translated.height / 2;
  const overCenter = event.over.rect.top + event.over.rect.height / 2;
  return activeCenter > overCenter;
}

export function IssueBoard({
  issues,
  scopeTeamIds,
}: {
  issues: Issue[];
  scopeTeamIds?: string[];
}) {
  const {
    data,
    preferences,
    updateIssue,
    setSelectedIssueId,
    setCreateIssueOpen,
  } = useWorkspace();
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const columns = useMemo(
    () => buildIssueBoardColumns(issues, data.states, scopeTeamIds),
    [data.states, issues, scopeTeamIds],
  );
  const activeIssue = data.issues.find((issue) => issue.id === activeIssueId);

  function handleDragStart(event: DragStartEvent) {
    setActiveIssueId(String(event.active.id));
    setMoveAnnouncement("");
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveIssueId(null);
    if (!event.over) {
      setMoveAnnouncement("未检测到目标状态，Issue 没有移动。");
      return;
    }
    const issueId = String(event.active.id);
    const issue = data.issues.find((item) => item.id === issueId);
    if (!issue) return;
    const statusId = event.over.data.current?.statusId;
    const statusType = event.over.data.current?.statusType as WorkflowStateType | null | undefined;
    const columnId = event.over.data.current?.columnId;
    const nextStatusId = resolveIssueBoardStatus(
      issue,
      {
        statusId: typeof statusId === "string" ? statusId : null,
        statusType,
      },
      data.states,
    );
    const targetLabel = String(event.over.data.current?.label ?? "目标状态");
    if (!nextStatusId) {
      setMoveAnnouncement(`${issue.identifier} 无法移至 ${targetLabel}。`);
      return;
    }
    const currentState = data.states.find((state) => state.id === issue.statusId);
    const targetState = data.states.find((state) => state.id === nextStatusId);
    if (!targetState) return;
    const statusChanged = issue.statusId !== nextStatusId;
    const targetColumn = typeof columnId === "string"
      ? columns.find((column) => column.id === columnId)
      : undefined;
    const overIssueId = event.over.data.current?.issueId;
    const sortOrder = preferences.sortBy === "manual" && targetColumn
      ? calculateIssueSortOrder(
          issues
            .filter((item) => targetColumn.stateIds.includes(item.statusId))
            .toSorted((left, right) => left.sortOrder - right.sortOrder),
          issue,
          typeof overIssueId === "string" ? overIssueId : null,
          isAfterOver(event),
        )
      : null;
    if (!statusChanged && sortOrder === null) {
      setMoveAnnouncement(`${issue.identifier} 已在 ${targetLabel}，状态和顺序未改变。`);
      return;
    }

    const changes: Partial<Issue> = getIssueStatusTransitionChanges(
      issue,
      currentState,
      targetState,
    );
    if (sortOrder !== null) changes.sortOrder = sortOrder;
    const success = await updateIssue(
      issueId,
      changes,
    );
    setMoveAnnouncement(
      success
        ? statusChanged
          ? `${issue.identifier} 已移至 ${targetLabel}。`
          : `${issue.identifier} 在 ${targetLabel} 中的顺序已更新。`
        : `${issue.identifier} 移动失败，已恢复原状态。`,
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: "按空格键拿起 Issue，使用方向键选择状态，再按空格键放下。按 Esc 取消。",
        },
      }}
      onDragStart={handleDragStart}
      onDragEnd={(event) => void handleDragEnd(event)}
      onDragCancel={() => {
        setActiveIssueId(null);
        setMoveAnnouncement("已取消移动，Issue 状态未改变。");
      }}
    >
      <p className="sr-only" role="status" aria-live="polite">{moveAnnouncement}</p>
      <div className="flex h-full min-h-[420px] gap-3 overflow-x-auto border-t border-border bg-background p-3" aria-label="Issue 看板">
        {columns.map((column) => {
          const columnIssues = issues.filter((issue) => column.stateIds.includes(issue.statusId));
          const canDrop = !activeIssue || resolveIssueBoardStatus(
            activeIssue,
            { statusId: column.statusId, statusType: column.statusType },
            data.states,
          ) !== null;
          return (
            <BoardColumn
              key={column.id}
              columnId={column.id}
              label={column.label}
              state={column.state}
              statusId={column.statusId}
              statusType={column.statusType}
              issues={columnIssues}
              dragActive={Boolean(activeIssue)}
              canDrop={canDrop}
              onOpen={setSelectedIssueId}
              onCreate={() => setCreateIssueOpen(true)}
            />
          );
        })}
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: "ease" }}>
        {activeIssue ? (
          <IssueCard
            issue={activeIssue}
            state={data.states.find((state) => state.id === activeIssue.statusId)}
            overlay
          />
        ) : null}
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
  dragActive,
  canDrop,
  onOpen,
  onCreate,
}: {
  columnId: string;
  label: string;
  state: WorkflowState;
  statusId: string | null;
  statusType: WorkflowStateType | null;
  issues: Issue[];
  dragActive: boolean;
  canDrop: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { data, updatingIssueIds } = useWorkspace();
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${columnId}`,
    data: { columnId, statusId, statusType, label },
    disabled: dragActive && !canDrop,
  });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex w-[292px] min-w-[292px] flex-col rounded-lg border border-border bg-surface-subtle/70 transition-[border-color,background-color,opacity,box-shadow] duration-150",
        dragActive && canDrop && "border-border-strong",
        dragActive && !canDrop && "opacity-40",
        isOver && canDrop && "border-accent bg-accent-soft shadow-[0_0_0_1px_var(--accent)]",
      )}
      aria-label={`状态列 ${label}`}
      data-board-column={columnId}
      data-drop-disabled={dragActive && !canDrop ? "true" : undefined}
    >
      <header className="flex h-10 items-center gap-2 px-3 text-xs font-medium">
        <StateIcon state={state} size={14} />
        <span>{label}</span>
        <span className="text-tertiary">{issues.length}</span>
        {isOver ? (
          <span className="ml-auto text-[10px] font-medium text-accent">释放以移动</span>
        ) : (
          <button type="button" onClick={onCreate} className="ml-auto grid size-7 place-items-center rounded text-tertiary transition-colors hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={`在 ${label} 中新建`}>
            <Plus size={14} />
          </button>
        )}
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        <SortableContext
          items={issues.map((issue) => issue.id)}
          strategy={verticalListSortingStrategy}
        >
          {issues.map((issue) => (
            <DraggableIssueCard
              key={issue.id}
              issue={issue}
              state={data.states.find((item) => item.id === issue.statusId)}
              columnId={columnId}
              columnStatusId={statusId}
              columnStatusType={statusType}
              columnLabel={label}
              canDrop={canDrop}
              pending={updatingIssueIds.has(issue.id)}
              onOpen={() => onOpen(issue.id)}
            />
          ))}
        </SortableContext>
        {issues.length === 0 ? (
          <button type="button" onClick={onCreate} className="grid h-20 place-items-center rounded-md border border-dashed border-border text-xs text-tertiary transition-colors hover:border-border-strong hover:bg-surface-hover">
            添加 Issue
          </button>
        ) : null}
      </div>
    </section>
  );
}

function DraggableIssueCard({
  issue,
  state,
  columnId,
  columnStatusId,
  columnStatusType,
  columnLabel,
  canDrop,
  pending,
  onOpen,
}: {
  issue: Issue;
  state: WorkflowState | undefined;
  columnId: string;
  columnStatusId: string | null;
  columnStatusType: WorkflowStateType | null;
  columnLabel: string;
  canDrop: boolean;
  pending: boolean;
  onOpen: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: issue.id,
    data: {
      issueId: issue.id,
      identifier: issue.identifier,
      columnId,
      statusId: columnStatusId,
      statusType: columnStatusType,
      label: columnLabel,
    },
    disabled: { draggable: pending, droppable: !canDrop },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("transition-opacity", isDragging && "opacity-20")}
      data-issue-card={issue.identifier}
    >
      <IssueCard
        issue={issue}
        state={state}
        onOpen={onOpen}
        pending={pending}
        dragAttributes={attributes}
        dragListeners={listeners}
        dragHandleRef={setActivatorNodeRef}
      />
    </div>
  );
}

function IssueCard({
  issue,
  state,
  onOpen,
  pending = false,
  dragAttributes,
  dragListeners,
  dragHandleRef,
  overlay = false,
}: {
  issue: Issue;
  state: WorkflowState | undefined;
  onOpen?: () => void;
  pending?: boolean;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  dragHandleRef?: (element: HTMLElement | null) => void;
  overlay?: boolean;
}) {
  const { data } = useWorkspace();
  const assignee = data.memberships.find((item) => item.userId === issue.assigneeId)?.user;
  const labels = data.labels.filter((label) => issue.labelIds.includes(label.id));
  const comments = data.comments.filter((comment) => comment.issueId === issue.id).length;
  return (
    <article
      className={cn(
        "group rounded-md border border-border bg-surface p-3 shadow-[0_1px_2px_rgb(0_0_0_/_5%)] transition-[border-color,box-shadow,opacity] duration-150 hover:border-border-strong",
        pending && "border-accent/60",
        overlay && "w-[276px] rotate-[1deg] border-border-strong shadow-[var(--shadow-popover)]",
      )}
      aria-busy={pending}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <button
          ref={dragHandleRef}
          type="button"
          disabled={pending || overlay}
          className="-ml-2 grid size-10 shrink-0 touch-none place-items-center rounded text-tertiary opacity-70 transition-[color,background-color,opacity,transform] hover:bg-surface-hover hover:text-primary active:scale-95 disabled:cursor-wait md:-ml-1 md:size-7 md:cursor-grab md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 md:active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={pending ? `正在保存 ${issue.identifier}` : `拖动 ${issue.identifier}`}
          title={pending ? "正在保存状态" : "拖动以改变状态"}
          {...dragAttributes}
          {...dragListeners}
        >
          {pending ? <LoaderCircle size={14} className="animate-spin" /> : <GripVertical size={14} />}
        </button>
        <StateIcon state={state} size={13} />
        <span className="font-mono text-[10px] text-tertiary">{issue.identifier}</span>
        <PriorityIcon priority={issue.priority} size={13} className="ml-auto" />
      </div>
      <button type="button" onClick={onOpen} className="block w-full rounded-sm text-left text-[13px] font-medium leading-5 outline-none focus-visible:ring-2 focus-visible:ring-accent">
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
