"use client";

import { useMemo, useState } from "react";
import { Archive, RotateCcw, Search, Trash2 } from "lucide-react";

import { StateIcon } from "@/components/issues/issue-glyphs";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { Issue } from "@/lib/domain";
import { cn } from "@/lib/utils";

type ArchiveTab = "archived" | "deleted";

export function ArchivedIssuesView() {
  const { data, mutate } = useWorkspace();
  const [tab, setTab] = useState<ArchiveTab>("archived");
  const [query, setQuery] = useState("");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const issues = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return data.issues
      .filter((issue) => tab === "deleted" ? Boolean(issue.trashedAt) : Boolean(issue.archivedAt && !issue.trashedAt))
      .filter((issue) => !normalized || `${issue.identifier} ${issue.title}`.toLocaleLowerCase().includes(normalized))
      .toSorted((left, right) => archiveDate(right, tab).localeCompare(archiveDate(left, tab)));
  }, [data.issues, query, tab]);

  async function restore(issue: Issue) {
    setRestoringId(issue.id);
    await mutate("issue.restore", { issueId: issue.id }, { successMessage: `${issue.identifier} 已恢复` });
    setRestoringId(null);
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface" aria-labelledby="archive-title">
      <header className="border-b border-border px-5 py-5 sm:px-7">
        <div className="flex items-center gap-2">
          <Archive size={17} className="text-tertiary" />
          <h1 id="archive-title" className="text-lg font-semibold tracking-[-0.025em]">Archive</h1>
        </div>
        <p className="mt-1 text-xs text-tertiary">查看并恢复已归档或移到回收站的 Issue。</p>
      </header>
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 sm:px-5">
        <div className="flex rounded-md border border-border bg-surface-subtle p-0.5">
          <TabButton active={tab === "archived"} onClick={() => setTab("archived")} icon={<Archive size={12} />}>已归档</TabButton>
          <TabButton active={tab === "deleted"} onClick={() => setTab("deleted")} icon={<Trash2 size={12} />}>回收站</TabButton>
        </div>
        <label className="ml-auto flex h-7 w-full max-w-56 items-center gap-1.5 rounded-md border border-border bg-surface-subtle px-2 sm:w-56">
          <Search size={12} className="text-tertiary" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Issue…" className="min-w-0 flex-1 bg-transparent text-[11px] outline-none" aria-label="搜索归档 Issue" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {issues.length ? (
          <div className="divide-y divide-border">
            {issues.map((issue) => {
              const team = data.teams.find((item) => item.id === issue.teamId);
              const state = data.states.find((item) => item.id === issue.statusId);
              return (
                <article key={issue.id} className="grid min-h-12 grid-cols-[82px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 hover:bg-surface-hover sm:px-6">
                  <span className="font-mono text-[11px] text-tertiary">{issue.identifier}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-primary">{issue.title}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-tertiary"><StateIcon state={state} size={11} />{team?.name ?? "未知团队"} · {formatArchiveDate(archiveDate(issue, tab))}</p>
                  </div>
                  <button type="button" onClick={() => void restore(issue)} disabled={restoringId === issue.id} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[11px] text-secondary hover:bg-surface-hover hover:text-primary disabled:opacity-50">
                    <RotateCcw size={12} /> 恢复
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="grid h-full min-h-72 place-items-center px-6 text-center">
            <div><span className="mx-auto grid size-10 place-items-center rounded-lg border border-border bg-surface-subtle text-tertiary">{tab === "deleted" ? <Trash2 size={17} /> : <Archive size={17} />}</span><h2 className="mt-3 text-sm font-medium">{query ? "没有匹配的 Issue" : tab === "deleted" ? "回收站为空" : "没有已归档的 Issue"}</h2><p className="mt-1 text-xs text-tertiary">{query ? "换一个关键词再试。" : "相关 Issue 会显示在这里，并可随时恢复。"}</p></div>
          </div>
        )}
      </div>
    </section>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={cn("inline-flex h-7 items-center gap-1.5 rounded px-2 text-[11px] text-tertiary hover:text-primary", active && "bg-surface text-primary shadow-sm")}>{icon}{children}</button>;
}

function archiveDate(issue: Issue, tab: ArchiveTab): string {
  return (tab === "deleted" ? issue.trashedAt : issue.archivedAt) ?? issue.updatedAt;
}

function formatArchiveDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
