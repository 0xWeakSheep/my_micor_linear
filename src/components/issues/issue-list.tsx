"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { Issue } from "@/lib/domain";
import { groupIssues, type IssueGroupField } from "@/modules/views/filter";
import { getIssuePriorityLabel } from "@/modules/issues/logic";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { IssueRow } from "./issue-row";
import { PriorityIcon, StateIcon, UserAvatar } from "./issue-glyphs";

export function IssueList({ issues }: { issues: Issue[] }) {
  const {
    data,
    preferences,
    selectedIssueIds,
    setSelectedIssueId,
    toggleIssueSelection,
    setCreateIssueOpen,
  } = useWorkspace();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const groupBy = preferences.groupBy as IssueGroupField;
  const groups = useMemo(() => groupIssues(issues, groupBy), [issues, groupBy]);
  const flatIssues = useMemo(() => groups.flatMap((group) => group.issues), [groups]);

  const statesById = useMemo(() => new Map(data.states.map((item) => [item.id, item])), [data.states]);
  const teamsById = useMemo(() => new Map(data.teams.map((item) => [item.id, item])), [data.teams]);
  const membersById = useMemo(() => new Map(data.memberships.map((item) => [item.userId, item])), [data.memberships]);
  const projectsById = useMemo(() => new Map(data.projects.map((item) => [item.id, item])), [data.projects]);
  const cyclesById = useMemo(() => new Map(data.cycles.map((item) => [item.id, item])), [data.cycles]);
  const labelsById = useMemo(() => new Map(data.labels.map((item) => [item.id, item])), [data.labels]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      if (flatIssues.length === 0) return;

      if (event.key.toLowerCase() === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setFocusedIndex((index) => Math.min(flatIssues.length - 1, index + 1));
      } else if (event.key.toLowerCase() === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setFocusedIndex((index) => Math.max(0, index - 1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        setSelectedIssueId(flatIssues[focusedIndex]?.id ?? null);
      } else if (event.key.toLowerCase() === "x") {
        event.preventDefault();
        const issue = flatIssues[focusedIndex];
        if (issue) toggleIssueSelection(issue.id, true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flatIssues, focusedIndex, setSelectedIssueId, toggleIssueSelection]);

  if (issues.length === 0) {
    return (
      <div className="grid min-h-[340px] place-items-center border-t border-border px-6 text-center">
        <div>
          <span className="mx-auto grid size-10 place-items-center rounded-full border border-border bg-surface-subtle text-tertiary">
            <Plus size={17} />
          </span>
          <h3 className="mt-3 text-sm font-medium">这里还没有 Issue</h3>
          <p className="mt-1 text-xs text-tertiary">创建一个 Issue，或调整当前筛选条件。</p>
          <button
            type="button"
            onClick={() => setCreateIssueOpen(true)}
            className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <Plus size={13} /> 新建 Issue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 border-t border-border" role="list" aria-label="Issue 列表">
      {groups.map((group, groupIndex) => {
        const isCollapsed = collapsed.has(group.key);
        const groupStart = groups
          .slice(0, groupIndex)
          .reduce((total, previousGroup) => total + previousGroup.issues.length, 0);
        return (
          <section key={group.key} aria-label={groupLabel(group.value, groupBy, data)}>
            <div className="sticky top-0 z-[2] flex h-9 items-center border-b border-border bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] px-2.5 backdrop-blur-md">
              <button
                type="button"
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(group.key)) next.delete(group.key);
                    else next.add(group.key);
                    return next;
                  })
                }
                className="flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-xs font-medium transition-colors hover:bg-surface-hover"
                aria-expanded={!isCollapsed}
              >
                <ChevronDown size={13} className={cn("text-tertiary transition-transform", isCollapsed && "-rotate-90")} />
                <GroupGlyph value={group.value} field={groupBy} data={data} />
                <span className="truncate">{groupLabel(group.value, groupBy, data)}</span>
                <span className="font-normal text-tertiary">{group.issues.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setCreateIssueOpen(true)}
                className="ml-auto grid size-7 place-items-center rounded text-tertiary transition-colors hover:bg-surface-hover hover:text-primary"
                aria-label={`在 ${groupLabel(group.value, groupBy, data)} 中新建 Issue`}
              >
                <Plus size={14} />
              </button>
            </div>
            {!isCollapsed
              ? group.issues.map((issue, index) => (
                  <IssueRow
                    key={`${group.key}:${issue.id}`}
                    issue={issue}
                    state={statesById.get(issue.statusId)}
                    team={teamsById.get(issue.teamId)}
                    assignee={issue.assigneeId ? membersById.get(issue.assigneeId) : undefined}
                    project={issue.projectId ? projectsById.get(issue.projectId) : undefined}
                    cycle={issue.cycleId ? cyclesById.get(issue.cycleId) : undefined}
                    labels={issue.labelIds.flatMap((labelId) => {
                      const label = labelsById.get(labelId);
                      return label ? [label] : [];
                    })}
                    comments={data.comments.filter((comment) => comment.issueId === issue.id)}
                    selected={selectedIssueIds.has(issue.id)}
                    focused={groupStart + index === focusedIndex}
                    compact={preferences.compactRows}
                    onOpen={() => setSelectedIssueId(issue.id)}
                    onToggle={(additive) => toggleIssueSelection(issue.id, additive)}
                  />
                ))
              : null}
          </section>
        );
      })}
    </div>
  );
}

function groupLabel(value: string | number | null, field: IssueGroupField, data: ReturnType<typeof useWorkspace>["data"]): string {
  if (value === null) return "未设置";
  switch (field) {
    case "status":
      return data.states.find((item) => item.id === value)?.name ?? "未知状态";
    case "assignee":
      return data.memberships.find((item) => item.userId === value)?.user.name ?? "未分配";
    case "project":
      return data.projects.find((item) => item.id === value)?.name ?? "无项目";
    case "priority":
      return getIssuePriorityLabel(Number(value) as Issue["priority"]);
    case "cycle": {
      const cycle = data.cycles.find((item) => item.id === value);
      return cycle ? `Cycle ${cycle.number}` : "无周期";
    }
    case "label":
      return data.labels.find((item) => item.id === value)?.name ?? "无标签";
    case "parent":
      return data.issues.find((item) => item.id === value)?.identifier ?? "无父 Issue";
    case "team":
      return data.teams.find((item) => item.id === value)?.name ?? "未知团队";
  }
}

function GroupGlyph({ value, field, data }: { value: string | number | null; field: IssueGroupField; data: ReturnType<typeof useWorkspace>["data"] }) {
  if (field === "status") return <StateIcon state={data.states.find((item) => item.id === value)} size={14} />;
  if (field === "priority") return <PriorityIcon priority={Number(value ?? 0) as Issue["priority"]} size={14} />;
  if (field === "assignee") return <UserAvatar user={data.memberships.find((item) => item.userId === value)?.user} size={17} />;
  const color =
    field === "project"
      ? data.projects.find((item) => item.id === value)?.color
      : field === "team"
        ? data.teams.find((item) => item.id === value)?.color
        : field === "label"
          ? data.labels.find((item) => item.id === value)?.color
          : undefined;
  return <span className="size-2.5 rounded-[3px] bg-surface-active" style={{ background: color }} />;
}
