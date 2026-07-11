"use client";

import { useMemo, type MouseEvent } from "react";
import { CalendarDays, MessageSquare, Network, Tag } from "lucide-react";
import { formatDistanceToNowStrict, isPast, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import type {
  Comment,
  Cycle,
  Issue,
  Label,
  Membership,
  Project,
  Team,
  WorkflowState,
} from "@/lib/domain";
import { cn } from "@/lib/utils";
import { PriorityIcon, StateIcon, UserAvatar } from "./issue-glyphs";

interface IssueRowProps {
  issue: Issue;
  state: WorkflowState | undefined;
  team: Team | undefined;
  assignee: Membership | undefined;
  project: Project | undefined;
  cycle: Cycle | undefined;
  labels: Label[];
  comments: Comment[];
  selected: boolean;
  focused?: boolean;
  compact?: boolean;
  onOpen: () => void;
  onToggle: (additive: boolean) => void;
}

export function IssueRow({
  issue,
  state,
  team,
  assignee,
  project,
  cycle,
  labels,
  comments,
  selected,
  focused = false,
  compact = false,
  onOpen,
  onToggle,
}: IssueRowProps) {
  const dueDate = useMemo(() => (issue.dueDate ? parseISO(issue.dueDate) : null), [issue.dueDate]);
  const isOverdue = dueDate && isPast(dueDate) && state?.type !== "completed";

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) onToggle(true);
    else onOpen();
  }

  return (
    <div
      className={cn(
        "group relative flex w-full items-center border-b border-border text-[13px] transition-colors last:border-b-0 hover:bg-surface-hover",
        compact ? "h-9" : "h-11",
        selected && "bg-accent-soft hover:bg-accent-soft",
        focused && "ring-1 ring-inset ring-accent",
      )}
      data-issue-id={issue.identifier}
    >
      <button
        type="button"
        onClick={() => onToggle(true)}
        className={cn(
          "ml-2 grid size-6 shrink-0 place-items-center rounded text-tertiary transition-opacity hover:bg-surface-active hover:text-primary",
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
        aria-label={selected ? `取消选择 ${issue.identifier}` : `选择 ${issue.identifier}`}
      >
        <span
          className={cn(
            "grid size-3.5 place-items-center rounded-[4px] border",
            selected ? "border-accent bg-accent text-white" : "border-border-strong bg-surface",
          )}
        >
          {selected ? <span className="text-[10px] leading-none">✓</span> : null}
        </span>
      </button>

      <button
        type="button"
        onClick={handleClick}
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-1 text-left outline-none"
        aria-label={`打开 ${issue.identifier} ${issue.title}`}
      >
        <PriorityIcon priority={issue.priority} className="shrink-0" />
        <StateIcon state={state} className="shrink-0" />
        <span className="w-[70px] shrink-0 font-mono text-[11px] text-tertiary">
          {issue.identifier}
        </span>
        <span className={cn("min-w-0 truncate font-medium", state?.type === "completed" && "text-secondary line-through decoration-border-strong")}>
          {issue.title}
        </span>
        {issue.parentId ? <Network size={13} className="shrink-0 text-tertiary" aria-label="子 Issue" /> : null}
      </button>

      <div className="ml-auto hidden shrink-0 items-center gap-1.5 pr-3 text-[11px] text-tertiary sm:flex">
        {labels.slice(0, 2).map((label) => (
          <span
            key={label.id}
            className="inline-flex max-w-28 items-center gap-1 truncate rounded border border-border bg-surface-subtle px-1.5 py-0.5"
          >
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: label.color }} />
            <span className="truncate">{label.name}</span>
          </span>
        ))}
        {labels.length > 2 ? (
          <span className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-tertiary">
            <Tag size={11} /> +{labels.length - 2}
          </span>
        ) : null}
        {project ? (
          <span className="hidden max-w-28 truncate rounded px-1.5 py-0.5 text-secondary lg:inline">
            {project.name}
          </span>
        ) : null}
        {cycle ? (
          <span className="hidden rounded px-1.5 py-0.5 text-secondary xl:inline">Cycle {cycle.number}</span>
        ) : null}
        {comments.length > 0 ? (
          <span className="inline-flex items-center gap-1 px-1" aria-label={`${comments.length} 条评论`}>
            <MessageSquare size={12} /> {comments.length}
          </span>
        ) : null}
        {dueDate ? (
          <span
            className={cn("inline-flex items-center gap-1 px-1", isOverdue && "text-danger")}
            title={issue.dueDate ?? undefined}
          >
            <CalendarDays size={12} />
            {formatDistanceToNowStrict(dueDate, { addSuffix: true, locale: zhCN })}
          </span>
        ) : null}
        {team ? (
          <span className="hidden size-5 place-items-center rounded text-[9px] font-bold text-white xl:grid" style={{ background: team.color }} title={team.name}>
            {team.key.slice(0, 1)}
          </span>
        ) : null}
        <UserAvatar user={assignee?.user} size={20} />
      </div>
    </div>
  );
}
