"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import {
  ArrowRight,
  FlagTriangleRight,
  GanttChartSquare,
  List,
  Plus,
  Target,
  X,
} from "lucide-react";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type {
  Initiative,
  InitiativeStatus,
  ProjectHealth,
  ProjectUpdate,
} from "@/lib/domain";
import { calculateProgress, calculateProjectProgress } from "@/modules/planning/progress";
import {
  buildTimelineMonths,
  DateCell,
  EmptyPlanningState,
  formatPriority,
  HealthBadge,
  InitiativeStatusBadge,
  INITIATIVE_STATUS_LABELS,
  MemberAvatar,
  Metric,
  ProgressBar,
  SegmentedControl,
  StatusBadge,
  timelineColumn,
} from "./shared";
import type { PlanningRouteProps } from "./types";

type InitiativeLayout = "roadmap" | "list";
type InitiativeUpdateChanges = Partial<
  Pick<Initiative, "status" | "priority" | "ownerId" | "targetDate" | "projectIds">
>;

const LAYOUTS = [
  { value: "roadmap", label: "路线图", icon: <GanttChartSquare size={13} /> },
  { value: "list", label: "列表", icon: <List size={13} /> },
] as const;

const INITIATIVE_STATUSES: InitiativeStatus[] = [
  "planned",
  "active",
  "paused",
  "completed",
];

const INITIATIVE_PRIORITIES: readonly Initiative["priority"][] = [0, 1, 2, 3, 4];

function latestProjectUpdates(updates: readonly ProjectUpdate[]): Map<string, ProjectUpdate> {
  const result = new Map<string, ProjectUpdate>();
  for (const update of updates) {
    const current = result.get(update.projectId);
    if (!current || Date.parse(update.createdAt) > Date.parse(current.createdAt)) {
      result.set(update.projectId, update);
    }
  }
  return result;
}

function initiativeHealth(
  initiative: Initiative,
  updatesByProject: ReadonlyMap<string, ProjectUpdate>,
): ProjectHealth | null {
  const health = initiative.projectIds
    .map((projectId) => updatesByProject.get(projectId)?.health)
    .filter((value): value is ProjectHealth => value !== undefined);
  if (health.includes("offTrack")) return "offTrack";
  if (health.includes("atRisk")) return "atRisk";
  if (health.includes("onTrack")) return "onTrack";
  return null;
}

export function InitiativesRoadmap({ details, onNavigate }: PlanningRouteProps) {
  const { data, mutate } = useWorkspace();
  const [layout, setLayout] = useState<InitiativeLayout>("roadmap");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [isPending, startTransition] = useTransition();

  const selected = data.initiatives.find((initiative) => initiative.id === details);
  const projectById = useMemo(
    () => new Map(data.projects.map((project) => [project.id, project])),
    [data.projects],
  );
  const membershipByUser = useMemo(
    () => new Map(data.memberships.map((membership) => [membership.userId, membership])),
    [data.memberships],
  );
  const updateByProject = useMemo(
    () => latestProjectUpdates(data.projectUpdates),
    [data.projectUpdates],
  );
  const progressByInitiative = useMemo(
    () =>
      new Map(
        data.initiatives.map((initiative) => {
          const projectIds = new Set(initiative.projectIds);
          return [
            initiative.id,
            calculateProgress(
              data.issues.filter(
                (issue) => issue.projectId !== null && projectIds.has(issue.projectId),
              ),
              data.states,
            ),
          ];
        }),
      ),
    [data.initiatives, data.issues, data.states],
  );
  const timelineBounds = useMemo(
    () =>
      new Map(
        data.initiatives.map((initiative) => {
          const projects = initiative.projectIds
            .map((projectId) => projectById.get(projectId))
            .filter((project) => project !== undefined);
          const starts = projects.map((project) => project.startDate).filter((date): date is string => date !== null);
          const targets = projects.map((project) => project.targetDate).filter((date): date is string => date !== null);
          const start = starts.toSorted()[0] ?? null;
          const target = initiative.targetDate ?? targets.toSorted().at(-1) ?? null;
          return [initiative.id, { start, target }];
        }),
      ),
    [data.initiatives, projectById],
  );
  const months = useMemo(
    () =>
      buildTimelineMonths(
        [...timelineBounds.values()].flatMap((bounds) => [bounds.start, bounds.target]),
      ),
    [timelineBounds],
  );

  const activeCount = data.initiatives.filter((initiative) => initiative.status === "active").length;
  const riskCount = data.initiatives.filter(
    (initiative) => initiativeHealth(initiative, updateByProject) !== "onTrack" && initiativeHealth(initiative, updateByProject) !== null,
  ).length;
  const projectCount = new Set(data.initiatives.flatMap((initiative) => initiative.projectIds)).size;

  function submitInitiative(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    startTransition(async () => {
      const result = await mutate<Initiative>(
        "initiative.create",
        { name: name.trim(), summary: summary.trim(), status: "planned" },
        { successMessage: "Initiative 已创建" },
      );
      if (result) {
        setName("");
        setSummary("");
        setCreating(false);
        onNavigate?.({ section: "initiatives", details: result.id });
      }
    });
  }

  function updateInitiative(
    initiativeId: string,
    changes: InitiativeUpdateChanges,
    successMessage: string,
  ) {
    startTransition(async () => {
      await mutate<Initiative>(
        "initiative.update",
        { initiativeId, changes },
        { successMessage },
      );
    });
  }

  function updateStatus(initiativeId: string, status: InitiativeStatus) {
    updateInitiative(initiativeId, { status }, "Initiative 状态已更新");
  }

  function linkProject(initiative: Initiative, projectId: string) {
    if (!projectId || initiative.projectIds.includes(projectId)) return;
    updateInitiative(
      initiative.id,
      { projectIds: [...initiative.projectIds, projectId] },
      "项目已关联",
    );
  }

  function unlinkProject(initiative: Initiative, projectId: string) {
    updateInitiative(
      initiative.id,
      { projectIds: initiative.projectIds.filter((id) => id !== projectId) },
      "项目关联已取消",
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-background" aria-labelledby="initiatives-title">
      <header className="border-b border-border bg-surface px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FlagTriangleRight size={17} className="text-tertiary" strokeWidth={1.7} />
              <h1 id="initiatives-title" className="text-base font-semibold tracking-tight text-primary">Initiatives</h1>
              <span className="font-mono text-xs text-tertiary">{data.initiatives.length}</span>
            </div>
            <p className="mt-0.5 text-xs text-secondary">把项目组合到长期目标和路线图中</p>
          </div>
          <div className="flex items-center gap-2">
            <SegmentedControl label="Initiative 布局" value={layout} options={LAYOUTS} onChange={setLayout} />
            <button
              type="button"
              onClick={() => setCreating((value) => !value)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-medium text-white hover:bg-accent-hover"
            >
              {creating ? <X size={14} /> : <Plus size={14} />}
              {creating ? "取消" : "新建目标"}
            </button>
          </div>
        </div>
        <div className="mt-4 grid max-w-xl grid-cols-3 gap-3 border-t border-border pt-3 sm:gap-5">
          <Metric label="进行中" value={activeCount} />
          <Metric label="有风险" value={riskCount} />
          <Metric label="关联项目" value={projectCount} />
        </div>
      </header>

      {creating ? (
        <form onSubmit={submitInitiative} className="grid gap-3 border-b border-border bg-panel px-4 py-4 sm:grid-cols-[minmax(180px,1fr)_minmax(240px,2fr)_auto] sm:px-6">
          <label className="grid gap-1.5 text-xs font-medium text-secondary">
            目标名称
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="h-9 rounded-md border border-border bg-surface px-3 text-sm outline-none focus:border-accent" placeholder="例如：提升企业客户体验" required />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-secondary">
            简介
            <input value={summary} onChange={(event) => setSummary(event.target.value)} className="h-9 rounded-md border border-border bg-surface px-3 text-sm outline-none focus:border-accent" placeholder="说明目标及衡量方式" />
          </label>
          <button type="submit" disabled={isPending || !name.trim()} className="mt-auto h-9 rounded-md border border-border-strong bg-surface-raised px-3 text-xs font-medium hover:bg-surface-hover disabled:opacity-50">{isPending ? "创建中" : "创建"}</button>
        </form>
      ) : null}

      {data.initiatives.length === 0 ? (
        <EmptyPlanningState
          title="还没有 Initiative"
          description="创建一个长期目标，再把支持这个目标的项目关联进来。"
          action={<button type="button" onClick={() => setCreating(true)} className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover">新建目标</button>}
        />
      ) : (
        <div className={`grid min-h-0 flex-1 ${selected ? "xl:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
          <div className={`min-h-0 overflow-auto ${selected ? "hidden xl:block" : ""}`}>
            {layout === "list" ? (
              <div className="min-w-[780px]">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 bg-panel text-[11px] font-medium text-tertiary">
                    <tr className="border-b border-border">
                      <th scope="col" className="w-[38%] px-4 py-2.5 sm:px-6">目标</th>
                      <th scope="col" className="px-3 py-2.5">状态</th>
                      <th scope="col" className="w-40 px-3 py-2.5">进度</th>
                      <th scope="col" className="px-3 py-2.5">负责人</th>
                      <th scope="col" className="px-3 py-2.5">目标日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.initiatives.map((initiative) => {
                      const progress = progressByInitiative.get(initiative.id)!;
                      return (
                        <tr key={initiative.id} className="border-b border-border/80 hover:bg-surface-hover">
                          <td className="px-4 py-3 sm:px-6">
                            <button type="button" onClick={() => onNavigate?.({ section: "initiatives", details: initiative.id })} className="block max-w-xl text-left">
                              <span className="block truncate text-sm font-medium text-primary hover:underline">{initiative.name}</span>
                              <span className="mt-0.5 block truncate text-xs text-tertiary">{initiative.summary || "暂无目标简介"}</span>
                            </button>
                          </td>
                          <td className="px-3 py-3"><div className="flex items-center gap-2"><InitiativeStatusBadge status={initiative.status} /><HealthBadge health={initiativeHealth(initiative, updateByProject)} /></div></td>
                          <td className="px-3 py-3"><div className="flex items-center gap-2"><ProgressBar value={progress.progress} label={`${initiative.name} 进度`} className="w-24" /><span className="font-mono text-xs text-secondary">{Math.round(progress.progress)}%</span></div></td>
                          <td className="px-3 py-3"><MemberAvatar membership={membershipByUser.get(initiative.ownerId ?? "")} size="sm" /></td>
                          <td className="px-3 py-3"><DateCell value={initiative.targetDate} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="min-w-[900px] p-4 sm:p-6">
                <div className="grid border-b border-border pb-2" style={{ gridTemplateColumns: `240px repeat(${months.length}, minmax(76px, 1fr))` }}>
                  <span className="px-2 text-[11px] font-medium text-tertiary">目标</span>
                  {months.map((month) => <span key={month.key} className="border-l border-border px-2 text-[11px] text-tertiary">{month.label}</span>)}
                </div>
                <div className="divide-y divide-border">
                  {data.initiatives.map((initiative) => {
                    const bounds = timelineBounds.get(initiative.id)!;
                    const start = timelineColumn(bounds.start, months, 1);
                    const end = Math.max(start, timelineColumn(bounds.target, months, months.length));
                    const progress = progressByInitiative.get(initiative.id)!;
                    return (
                      <div key={initiative.id} className="grid min-h-16 items-center hover:bg-surface-hover" style={{ gridTemplateColumns: `240px repeat(${months.length}, minmax(76px, 1fr))` }}>
                        <button type="button" onClick={() => onNavigate?.({ section: "initiatives", details: initiative.id })} className="min-w-0 px-2 text-left">
                          <span className="block truncate text-sm font-medium text-primary">{initiative.name}</span>
                          <span className="block truncate text-[11px] text-tertiary">{initiative.projectIds.length} 个项目</span>
                        </button>
                        <div className="relative mx-1 h-8 overflow-hidden rounded-md border border-[color-mix(in_srgb,var(--accent)_34%,var(--border))] bg-accent-soft" style={{ gridColumn: `${start + 1} / ${end + 2}` }}>
                          <span className="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]" style={{ width: `${progress.progress}%` }} />
                          <span className="relative flex h-full items-center justify-between gap-2 px-2 text-[11px] font-medium text-accent"><span className="truncate">{INITIATIVE_STATUS_LABELS[initiative.status]}</span><span className="font-mono">{Math.round(progress.progress)}%</span></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {selected ? (
            <aside className="min-h-0 overflow-auto bg-panel p-4 sm:p-5 xl:border-l xl:border-border xl:p-4" aria-labelledby="initiative-detail-title">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="initiative-detail-title" className="truncate text-base font-semibold text-primary">{selected.name}</h2>
                  <p className="mt-1 text-xs leading-5 text-secondary">{selected.summary || "暂无目标简介"}</p>
                </div>
                <button type="button" onClick={() => onNavigate?.({ section: "initiatives", details: null })} aria-label="关闭 Initiative 详情" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-surface-hover hover:text-primary"><X size={15} /></button>
              </div>
              <div className="mt-5 space-y-5" aria-busy={isPending}>
                <section aria-labelledby="initiative-properties-heading">
                  <div className="flex items-center justify-between gap-3">
                    <h3 id="initiative-properties-heading" className="text-xs font-medium text-tertiary">属性</h3>
                    <span className="text-[11px] text-tertiary" aria-live="polite">{isPending ? "保存中…" : ""}</span>
                  </div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    <label className="grid gap-1.5 text-xs font-medium text-tertiary">
                      状态
                      <select value={selected.status} disabled={isPending} onChange={(event) => updateStatus(selected.id, event.target.value as InitiativeStatus)} className="h-9 rounded-md border border-border bg-surface px-2.5 text-xs text-primary outline-none transition-colors focus:border-accent disabled:opacity-60">
                        {INITIATIVE_STATUSES.map((status) => <option key={status} value={status}>{INITIATIVE_STATUS_LABELS[status]}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1.5 text-xs font-medium text-tertiary">
                      Owner
                      <select
                        value={selected.ownerId ?? ""}
                        disabled={isPending}
                        onChange={(event) => updateInitiative(selected.id, { ownerId: event.target.value || null }, "Owner 已更新")}
                        className="h-9 rounded-md border border-border bg-surface px-2.5 text-xs text-primary outline-none transition-colors focus:border-accent disabled:opacity-60"
                      >
                        <option value="">未指派</option>
                        {selected.ownerId && !membershipByUser.has(selected.ownerId) ? <option value={selected.ownerId}>当前负责人（不可用）</option> : null}
                        {data.memberships.filter((membership) => membership.status === "active").map((membership) => <option key={membership.userId} value={membership.userId}>{membership.user.name}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1.5 text-xs font-medium text-tertiary">
                      Target Date
                      <input
                        type="date"
                        value={selected.targetDate?.slice(0, 10) ?? ""}
                        disabled={isPending}
                        onChange={(event) => updateInitiative(selected.id, { targetDate: event.target.value || null }, "目标日期已更新")}
                        className="h-9 min-w-0 rounded-md border border-border bg-surface px-2.5 text-xs text-primary outline-none transition-colors focus:border-accent disabled:opacity-60"
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-medium text-tertiary">
                      优先级
                      <select
                        value={selected.priority}
                        disabled={isPending}
                        onChange={(event) => updateInitiative(selected.id, { priority: Number(event.target.value) as Initiative["priority"] }, "优先级已更新")}
                        className="h-9 rounded-md border border-border bg-surface px-2.5 text-xs text-primary outline-none transition-colors focus:border-accent disabled:opacity-60"
                      >
                        {INITIATIVE_PRIORITIES.map((priority) => <option key={priority} value={priority}>{formatPriority(priority)}</option>)}
                      </select>
                    </label>
                  </div>
                </section>
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="项目" value={selected.projectIds.length} />
                  <Metric label="进度" value={`${Math.round(progressByInitiative.get(selected.id)?.progress ?? 0)}%`} />
                </div>
                <div className="rounded-md border border-border bg-surface p-3">
                  <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-tertiary">健康状态</span><HealthBadge health={initiativeHealth(selected, updateByProject)} /></div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-1.5 text-tertiary"><Target size={13} /> 目标日期</span><DateCell value={selected.targetDate} /></div>
                </div>
                <section aria-labelledby="initiative-projects-heading">
                  <div className="flex items-center justify-between gap-3">
                    <h3 id="initiative-projects-heading" className="text-xs font-medium text-tertiary">关联项目</h3>
                    <span className="font-mono text-[11px] text-tertiary">{selected.projectIds.length}</span>
                  </div>
                  <label className="mt-2 block">
                    <span className="sr-only">添加关联项目</span>
                    <select
                      aria-label="添加关联项目"
                      value=""
                      disabled={isPending || data.projects.every((project) => selected.projectIds.includes(project.id))}
                      onChange={(event) => linkProject(selected, event.target.value)}
                      className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-xs text-primary outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">{data.projects.every((project) => selected.projectIds.includes(project.id)) ? "没有可关联的项目" : "选择要关联的项目…"}</option>
                      {data.projects.filter((project) => !selected.projectIds.includes(project.id)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select>
                  </label>
                  <div className="mt-2 space-y-1">
                    {selected.projectIds.map((projectId) => {
                      const project = projectById.get(projectId);
                      if (!project) return null;
                      const progress = calculateProjectProgress(project, data.issues, data.states);
                      return (
                        <div key={project.id} className="flex items-start gap-1 rounded-md border border-transparent p-1 hover:border-border hover:bg-surface-hover">
                          <button type="button" onClick={() => onNavigate?.({ section: "projects", details: project.id })} className="min-w-0 flex-1 rounded px-1 py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                            <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-primary">{project.name}</span><ArrowRight size={13} className="shrink-0 text-tertiary" /></div>
                            <div className="mt-1.5 flex items-center gap-2"><ProgressBar value={progress.progress} label={`${project.name} 进度`} className="flex-1" /><span className="font-mono text-[11px] text-tertiary">{Math.round(progress.progress)}%</span></div>
                            <div className="mt-1.5"><StatusBadge status={project.status} /></div>
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => unlinkProject(selected, project.id)}
                            aria-label={`取消关联 ${project.name}`}
                            title="取消关联"
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-tertiary transition-colors hover:bg-surface-active hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      );
                    })}
                    {selected.projectIds.length === 0 ? <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-tertiary">尚未关联项目</p> : null}
                  </div>
                </section>
              </div>
            </aside>
          ) : null}
        </div>
      )}
    </section>
  );
}
