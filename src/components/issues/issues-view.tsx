"use client";

import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Check,
  ChevronDown,
  Filter,
  LayoutGrid,
  List,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { Issue } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { filterIssues, sortIssues } from "@/modules/views/filter";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { IssueBoard } from "./issue-board";
import { IssueList } from "./issue-list";

interface IssuesViewProps {
  issues: Issue[];
  scopeTeamIds?: string[];
  title?: string;
  description?: string;
}

export function IssuesView({ issues, scopeTeamIds, title, description }: IssuesViewProps) {
  const {
    data,
    preferences,
    setPreferences,
    selectedIssueIds,
    setSelectedIssueIds,
    mutate,
  } = useWorkspace();
  const [quickSearch, setQuickSearch] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const result = useMemo(() => {
    const filtered = filterIssues(
      issues,
      {
        ...preferences.filters,
        search: [preferences.filters.search, quickSearch].filter(Boolean).join(" "),
      },
      { comments: data.comments },
    );
    return sortIssues(filtered, { field: preferences.sortBy });
  }, [issues, preferences.filters, preferences.sortBy, quickSearch, data.comments]);

  async function bulkUpdate(changes: Partial<Issue>) {
    const ids = [...selectedIssueIds];
    const success = await mutate("issue.bulkUpdate", { issueIds: ids, changes }, { successMessage: `${ids.length} 个 Issue 已更新` });
    if (success) setSelectedIssueIds(new Set());
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {title ? (
        <div className="px-5 pb-3 pt-5 sm:px-7">
          <h1 className="text-lg font-semibold tracking-[-0.025em]">{title}</h1>
          {description ? <p className="mt-1 text-xs text-tertiary">{description}</p> : null}
        </div>
      ) : null}
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-t border-border px-3 sm:px-4">
        <FilterMenu />
        <DisplayMenu />
        <span className="ml-1 text-[11px] text-tertiary">{result.length} issues</span>
        <div className="ml-auto flex items-center gap-1">
          {searchVisible ? (
            <label className="flex h-7 w-44 items-center gap-1.5 rounded-md border border-border bg-surface-subtle px-2 focus-within:border-accent">
              <Search size={12} className="text-tertiary" />
              <input autoFocus value={quickSearch} onChange={(event) => setQuickSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[11px] outline-none" placeholder="筛选当前视图…" />
              <button type="button" onClick={() => { setQuickSearch(""); setSearchVisible(false); }} aria-label="关闭搜索"><X size={11} className="text-tertiary" /></button>
            </label>
          ) : (
            <ToolbarButton label="搜索当前视图" onClick={() => setSearchVisible(true)}><Search size={13} /></ToolbarButton>
          )}
          <div className="flex rounded-md border border-border bg-surface-subtle p-0.5">
            <ToolbarButton label="列表" active={preferences.layout === "list"} onClick={() => setPreferences({ layout: "list" })}><List size={13} /></ToolbarButton>
            <ToolbarButton label="看板" active={preferences.layout === "board"} onClick={() => setPreferences({ layout: "board" })}><LayoutGrid size={13} /></ToolbarButton>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {preferences.layout === "list" ? (
          <IssueList issues={result} />
        ) : (
          <IssueBoard
            issues={result}
            scopeTeamIds={scopeTeamIds ?? [...new Set(issues.map((issue) => issue.teamId))]}
          />
        )}
      </div>

      {selectedIssueIds.size > 0 ? (
        <div className="fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border-strong bg-surface-raised p-1.5 shadow-[var(--shadow-popover)]">
          <span className="px-2 text-xs font-medium">已选择 {selectedIssueIds.size}</span>
          <BulkSelect label="状态" options={data.states.map((state) => ({ value: state.id, label: state.name }))} onChange={(value) => void bulkUpdate({ statusId: value })} />
          <BulkSelect label="负责人" options={[{ value: "", label: "未分配" }, ...data.memberships.map((member) => ({ value: member.userId, label: member.user.name }))]} onChange={(value) => void bulkUpdate({ assigneeId: value || null })} />
          <BulkSelect label="优先级" options={[{ value: "0", label: "无" }, { value: "1", label: "紧急" }, { value: "2", label: "高" }, { value: "3", label: "中" }, { value: "4", label: "低" }]} onChange={(value) => void bulkUpdate({ priority: Number(value) as Issue["priority"] })} />
          <button type="button" onClick={() => setSelectedIssueIds(new Set())} className="grid size-7 place-items-center rounded text-tertiary hover:bg-surface-hover hover:text-primary" aria-label="清除选择"><X size={13} /></button>
        </div>
      ) : null}

    </div>
  );
}

function FilterMenu() {
  const { data, preferences, setPreferences } = useWorkspace();
  const filters = preferences.filters;
  const activeCount = [filters.teamIds, filters.statusIds, filters.priorities, filters.assigneeIds, filters.labelIds, filters.projectIds, filters.cycleIds].filter((value) => value?.length).length;
  return (
    <Popover.Root>
      <Popover.Trigger asChild><button type="button" className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-secondary transition-colors hover:bg-surface-hover", activeCount && "bg-accent-soft text-primary")}><Filter size={12} /> 筛选 {activeCount ? <span className="rounded bg-accent px-1 text-[9px] text-white">{activeCount}</span> : null}<ChevronDown size={10} /></button></Popover.Trigger>
      <Popover.Portal><Popover.Content align="start" sideOffset={6} className="z-40 w-72 rounded-lg border border-border-strong bg-surface-raised p-2 shadow-[var(--shadow-popover)] outline-none">
        <FilterSection title="状态" options={data.states.map((state) => ({ value: state.id, label: state.name }))} selected={filters.statusIds ?? []} onChange={(values) => setPreferences({ filters: { ...filters, statusIds: values } })} />
        <FilterSection title="负责人" options={data.memberships.map((member) => ({ value: member.userId, label: member.user.name }))} selected={filters.assigneeIds ?? []} onChange={(values) => setPreferences({ filters: { ...filters, assigneeIds: values } })} />
        <FilterSection title="优先级" options={[{ value: "1", label: "紧急" }, { value: "2", label: "高" }, { value: "3", label: "中" }, { value: "4", label: "低" }, { value: "0", label: "无" }]} selected={(filters.priorities ?? []).map(String)} onChange={(values) => setPreferences({ filters: { ...filters, priorities: values.map(Number) } })} />
        <div className="mt-2 border-t border-border pt-2"><button type="button" onClick={() => setPreferences({ filters: {} })} className="flex h-7 w-full items-center justify-center rounded text-[11px] text-secondary hover:bg-surface-hover">清除所有筛选</button></div>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  );
}

function FilterSection({ title, options, selected, onChange }: { title: string; options: Array<{ value: string; label: string }>; selected: string[]; onChange: (values: string[]) => void }) {
  return <div className="mb-2"><p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-tertiary">{title}</p><div className="max-h-36 overflow-auto">{options.map((option) => { const checked = selected.includes(option.value); return <button key={option.value} type="button" onClick={() => onChange(checked ? selected.filter((value) => value !== option.value) : [...selected, option.value])} className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px] hover:bg-surface-hover"><span className={cn("grid size-3.5 place-items-center rounded border", checked ? "border-accent bg-accent text-white" : "border-border-strong")}>{checked ? <Check size={9} /> : null}</span><span className="truncate">{option.label}</span></button>; })}</div></div>;
}

function DisplayMenu() {
  const { preferences, setPreferences } = useWorkspace();
  return <Popover.Root><Popover.Trigger asChild><button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-secondary transition-colors hover:bg-surface-hover"><Settings2 size={12} /> 显示 <ChevronDown size={10} /></button></Popover.Trigger><Popover.Portal><Popover.Content align="start" sideOffset={6} className="z-40 w-56 rounded-lg border border-border-strong bg-surface-raised p-2 shadow-[var(--shadow-popover)] outline-none">
    <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-tertiary">分组</p>
    <select value={preferences.groupBy} onChange={(event) => setPreferences({ groupBy: event.target.value as typeof preferences.groupBy })} className="h-8 w-full rounded border border-border bg-surface px-2 text-[11px] outline-none"><option value="status">状态</option><option value="priority">优先级</option><option value="assignee">负责人</option><option value="project">项目</option><option value="cycle">周期</option><option value="team">团队</option></select>
    <p className="mt-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-tertiary">排序</p>
    <select value={preferences.sortBy} onChange={(event) => setPreferences({ sortBy: event.target.value as typeof preferences.sortBy })} className="h-8 w-full rounded border border-border bg-surface px-2 text-[11px] outline-none"><option value="manual">手动</option><option value="priority">优先级</option><option value="createdAt">创建时间</option><option value="updatedAt">更新时间</option><option value="dueDate">截止日期</option></select>
    <label className="mt-2 flex h-8 items-center gap-2 rounded px-2 text-[11px] hover:bg-surface-hover"><input type="checkbox" checked={preferences.compactRows} onChange={(event) => setPreferences({ compactRows: event.target.checked })} />紧凑行</label>
  </Popover.Content></Popover.Portal></Popover.Root>;
}

function ToolbarButton({ label, active = false, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("grid size-7 place-items-center rounded text-tertiary transition-colors hover:bg-surface-hover hover:text-primary", active && "bg-surface-active text-primary")} aria-label={label} title={label}>{children}</button>;
}

function BulkSelect({ label, options, onChange }: { label: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <label className="relative inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] text-secondary hover:bg-surface-hover"><SlidersHorizontal size={11} />{label}<select value="" onChange={(event) => { if (event.target.value !== "__placeholder") onChange(event.target.value); }} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`批量修改${label}`}><option value="__placeholder">选择</option>{options.map((option) => <option key={option.value || "empty"} value={option.value}>{option.label}</option>)}</select></label>;
}
