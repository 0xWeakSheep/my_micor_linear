"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import {
  Archive,
  CalendarRange,
  Columns3,
  FolderKanban,
  GanttChartSquare,
  List,
  Loader2,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { ActionResult, Project, ProjectStatus, ProjectUpdate } from "@/lib/domain";
import { calculateProjectProgress } from "@/modules/planning/progress";
import {
  buildTimelineMonths,
  DateCell,
  EmptyPlanningState,
  formatPlanningDate,
  formatPriority,
  HealthBadge,
  MemberAvatar,
  Metric,
  ProgressBar,
  PROJECT_STATUS_LABELS,
  SegmentedControl,
  StatusBadge,
  timelineColumn,
} from "./shared";
import type { PlanningRouteProps } from "./types";

type ProjectLayout = "list" | "board" | "timeline";

const LAYOUT_OPTIONS = [
  { value: "list", label: "列表", icon: <List size={13} strokeWidth={1.8} /> },
  { value: "board", label: "看板", icon: <Columns3 size={13} strokeWidth={1.8} /> },
  {
    value: "timeline",
    label: "时间线",
    icon: <GanttChartSquare size={13} strokeWidth={1.8} />,
  },
] as const;

const BOARD_STATUSES: ProjectStatus[] = [
  "planned",
  "started",
  "paused",
  "completed",
  "canceled",
];

function latestUpdatesByProject(updates: readonly ProjectUpdate[]): Map<string, ProjectUpdate> {
  const latest = new Map<string, ProjectUpdate>();
  for (const update of updates) {
    const current = latest.get(update.projectId);
    if (!current || Date.parse(update.createdAt) > Date.parse(current.createdAt)) {
      latest.set(update.projectId, update);
    }
  }
  return latest;
}

export function ProjectsHub({ onNavigate }: PlanningRouteProps) {
  const { data, mutate } = useWorkspace();
  const [layout, setLayout] = useState<ProjectLayout>("list");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [restoringProjectId, setRestoringProjectId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const membershipByUser = useMemo(
    () => new Map(data.memberships.map((membership) => [membership.userId, membership])),
    [data.memberships],
  );
  const teamById = useMemo(
    () => new Map(data.teams.map((team) => [team.id, team])),
    [data.teams],
  );
  const progressByProject = useMemo(
    () =>
      new Map(
        data.projects.map((project) => [
          project.id,
          calculateProjectProgress(project, data.issues, data.states),
        ]),
      ),
    [data.issues, data.projects, data.states],
  );
  const latestUpdate = useMemo(
    () => latestUpdatesByProject(data.projectUpdates),
    [data.projectUpdates],
  );
  const months = useMemo(
    () =>
      buildTimelineMonths(
        data.projects.flatMap((project) => [project.startDate, project.targetDate]),
      ),
    [data.projects],
  );
  const activeCount = data.projects.filter((project) => project.status === "started").length;
  const completedCount = data.projects.filter(
    (project) => project.status === "completed",
  ).length;
  const riskCount = [...latestUpdate.values()].filter(
    (update) => update.health !== "onTrack",
  ).length;

  function openProject(projectId: string) {
    onNavigate?.({ section: "projects", details: projectId });
  }

  function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectName = name.trim();
    if (!projectName || !data.teams[0]) return;

    startTransition(async () => {
      const result = await mutate<Project>(
        "project.create",
        {
          name: projectName,
          summary: summary.trim(),
          status: "planned",
          teamIds: [data.teams[0].id],
        },
        { successMessage: "项目已创建" },
      );
      if (result) {
        setName("");
        setSummary("");
        setCreating(false);
        onNavigate?.({ section: "projects", details: result.id });
      }
    });
  }

  async function loadArchivedProjects() {
    setArchivedLoading(true);
    setArchivedError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(data.workspace.slug)}/projects/archived`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as ActionResult<Project[]>;
      if (!response.ok || !result.ok) throw new Error(result.error ?? "无法加载归档项目");
      setArchivedProjects(result.data ?? []);
    } catch (error) {
      setArchivedError(error instanceof Error ? error.message : "无法加载归档项目");
    } finally {
      setArchivedLoading(false);
    }
  }

  function toggleArchivedProjects() {
    if (archivedOpen) {
      setArchivedOpen(false);
      return;
    }
    setArchivedOpen(true);
    void loadArchivedProjects();
  }

  async function restoreProject(project: Project) {
    setRestoringProjectId(project.id);
    const restored = await mutate<Project>(
      "project.restore",
      { projectId: project.id },
      { successMessage: `${project.name} 已恢复` },
    );
    if (restored) {
      setArchivedProjects((current) => current.filter((candidate) => candidate.id !== project.id));
    }
    setRestoringProjectId(null);
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-background" aria-labelledby="projects-title">
      <header className="border-b border-border bg-surface px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CalendarRange size={17} className="text-tertiary" strokeWidth={1.7} />
              <h1 id="projects-title" className="text-base font-semibold tracking-tight text-primary">
                项目
              </h1>
              <span className="font-mono text-xs text-tertiary">{data.projects.length}</span>
            </div>
            <p className="mt-0.5 text-xs text-secondary">规划跨团队工作并跟踪交付进度</p>
          </div>
          <div className="flex items-center gap-2">
            <SegmentedControl
              label="项目布局"
              value={layout}
              options={LAYOUT_OPTIONS}
              onChange={setLayout}
            />
            <button
              type="button"
              onClick={toggleArchivedProjects}
              aria-expanded={archivedOpen}
              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-secondary transition-colors hover:bg-surface-hover hover:text-primary"
            >
              {archivedOpen ? <X size={13} /> : <Archive size={13} />}
              <span className="hidden sm:inline">{archivedOpen ? "关闭归档" : "归档项目"}</span>
            </button>
            <button
              type="button"
              onClick={() => setCreating((current) => !current)}
              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md bg-accent px-2.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover active:translate-y-px"
            >
              {creating ? <X size={14} /> : <Plus size={14} />}
              {creating ? "取消" : "新建项目"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3 sm:max-w-xl sm:gap-5">
          <Metric label="进行中" value={activeCount} />
          <Metric label="有风险" value={riskCount} />
          <Metric label="已完成" value={completedCount} />
        </div>
      </header>

      {archivedOpen ? (
        <section className="border-b border-border bg-panel px-4 py-4 sm:px-6" aria-labelledby="archived-projects-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="archived-projects-heading" className="text-sm font-medium text-primary">归档项目</h2>
              <p className="mt-0.5 text-xs text-tertiary">归档不会删除 Issue、里程碑或项目更新。</p>
            </div>
            <span className="font-mono text-[11px] text-tertiary">{archivedProjects.length}</span>
          </div>
          {archivedLoading ? (
            <div className="mt-3 flex min-h-20 items-center justify-center gap-2 rounded-md border border-border bg-surface text-xs text-tertiary">
              <Loader2 size={14} className="animate-spin" /> 加载归档项目…
            </div>
          ) : archivedError ? (
            <div className="mt-3 flex min-h-20 flex-col items-center justify-center gap-2 rounded-md border border-danger/30 bg-[var(--danger-soft)] px-4 text-center text-xs text-danger">
              <span>{archivedError}</span>
              <button type="button" onClick={() => void loadArchivedProjects()} className="rounded border border-current px-2 py-1 font-medium">重试</button>
            </div>
          ) : archivedProjects.length > 0 ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {archivedProjects.map((project) => (
                <article key={project.id} className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-surface p-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md text-white" style={{ backgroundColor: project.color }}><FolderKanban size={14} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-primary">{project.name}</p>
                    <p className="mt-0.5 text-[11px] text-tertiary">归档于 {formatPlanningDate(project.archivedAt)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void restoreProject(project)}
                    disabled={restoringProjectId === project.id}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 text-xs font-medium text-secondary hover:bg-surface-hover hover:text-primary disabled:opacity-50"
                  >
                    {restoringProjectId === project.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    恢复
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-tertiary">还没有归档项目</p>
          )}
        </section>
      ) : null}

      {creating ? (
        <form
          onSubmit={submitProject}
          className="grid gap-3 border-b border-border bg-panel px-4 py-4 sm:grid-cols-[minmax(180px,1fr)_minmax(240px,2fr)_auto] sm:px-6"
        >
          <label className="grid gap-1.5 text-xs font-medium text-secondary">
            项目名称
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-primary outline-none transition-colors placeholder:text-tertiary focus:border-accent"
              placeholder="例如：移动端新导航"
              required
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-secondary">
            简介
            <input
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-primary outline-none transition-colors placeholder:text-tertiary focus:border-accent"
              placeholder="一句话说明交付目标"
            />
          </label>
          <button
            type="submit"
            disabled={isPending || !name.trim() || data.teams.length === 0}
            className="mt-auto h-9 rounded-md border border-border-strong bg-surface-raised px-3 text-xs font-medium text-primary transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            {isPending ? "创建中" : "创建"}
          </button>
        </form>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {data.projects.length === 0 ? (
          <EmptyPlanningState
            title="还没有项目"
            description="创建一个项目，把相关 Issue、里程碑和更新集中到同一个交付目标中。"
            action={
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover"
              >
                新建项目
              </button>
            }
          />
        ) : layout === "list" ? (
          <div className="min-w-[760px]">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-panel text-[11px] font-medium text-tertiary">
                <tr className="border-b border-border">
                  <th scope="col" className="w-[38%] px-4 py-2.5 sm:px-6">项目</th>
                  <th scope="col" className="px-3 py-2.5">状态</th>
                  <th scope="col" className="w-40 px-3 py-2.5">进度</th>
                  <th scope="col" className="px-3 py-2.5">负责人</th>
                  <th scope="col" className="px-3 py-2.5">目标日期</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((project) => {
                  const progress = progressByProject.get(project.id)!;
                  const update = latestUpdate.get(project.id);
                  return (
                    <tr key={project.id} className="border-b border-border/80 hover:bg-surface-hover">
                      <td className="px-4 py-3 sm:px-6">
                        <button
                          type="button"
                          onClick={() => openProject(project.id)}
                          className="flex min-w-0 items-center gap-2.5 text-left"
                        >
                          <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white"
                            style={{ backgroundColor: project.color }}
                            aria-hidden="true"
                          >
                            <FolderKanban size={14} aria-hidden="true" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-primary hover:underline">
                              {project.name}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-tertiary">
                              {project.summary || "暂无项目简介"}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={project.status} />
                          <HealthBadge health={update?.health ?? null} />
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <ProgressBar value={progress.progress} label={`${project.name} 进度`} className="w-24" />
                          <span className="w-8 text-right font-mono text-xs text-secondary">
                            {Math.round(progress.progress)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <MemberAvatar membership={membershipByUser.get(project.leadId ?? "")} size="sm" />
                      </td>
                      <td className="px-3 py-3"><DateCell value={project.targetDate} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : layout === "board" ? (
          <div className="grid min-h-full auto-cols-[280px] grid-flow-col gap-3 overflow-x-auto p-4 sm:p-6">
            {BOARD_STATUSES.map((status) => {
              const projects = data.projects.filter((project) => project.status === status);
              return (
                <section key={status} aria-labelledby={`project-column-${status}`} className="min-w-0">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <h2 id={`project-column-${status}`} className="text-xs font-medium text-secondary">
                      {PROJECT_STATUS_LABELS[status]}
                    </h2>
                    <span className="font-mono text-[11px] text-tertiary">{projects.length}</span>
                  </div>
                  <div className="space-y-2">
                    {projects.map((project) => {
                      const progress = progressByProject.get(project.id)!;
                      const teamNames = project.teamIds
                        .map((teamId) => teamById.get(teamId)?.name)
                        .filter(Boolean)
                        .join(", ");
                      return (
                        <button
                          key={project.id}
                          type="button"
                          onClick={() => openProject(project.id)}
                          className="w-full rounded-md border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-hover active:translate-y-px"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="line-clamp-2 text-sm font-medium leading-5 text-primary">
                              {project.name}
                            </span>
                            <MemberAvatar membership={membershipByUser.get(project.leadId ?? "")} size="sm" />
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-secondary">
                            {project.summary || "暂无项目简介"}
                          </p>
                          <div className="mt-3 flex items-center gap-2">
                            <ProgressBar value={progress.progress} label={`${project.name} 进度`} className="flex-1" />
                            <span className="font-mono text-[11px] text-tertiary">{Math.round(progress.progress)}%</span>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-tertiary">
                            <span className="truncate">{teamNames || "未关联团队"}</span>
                            <span>{formatPriority(project.priority)}</span>
                          </div>
                        </button>
                      );
                    })}
                    {projects.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-xs text-tertiary">
                        暂无项目
                      </div>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="min-w-[900px] p-4 sm:p-6">
            <div
              className="grid border-b border-border pb-2"
              style={{ gridTemplateColumns: `220px repeat(${months.length}, minmax(72px, 1fr))` }}
            >
              <span className="px-2 text-[11px] font-medium text-tertiary">项目</span>
              {months.map((month) => (
                <span key={month.key} className="border-l border-border px-2 text-[11px] text-tertiary">
                  {month.label}
                </span>
              ))}
            </div>
            <div className="divide-y divide-border">
              {data.projects.map((project) => {
                const start = timelineColumn(project.startDate, months, 1);
                const end = Math.max(start, timelineColumn(project.targetDate, months, months.length));
                const progress = progressByProject.get(project.id)!;
                return (
                  <div
                    key={project.id}
                    className="grid min-h-14 items-center hover:bg-surface-hover"
                    style={{ gridTemplateColumns: `220px repeat(${months.length}, minmax(72px, 1fr))` }}
                  >
                    <button
                      type="button"
                      onClick={() => openProject(project.id)}
                      className="min-w-0 px-2 text-left"
                    >
                      <span className="block truncate text-sm font-medium text-primary">{project.name}</span>
                      <span className="block truncate text-[11px] text-tertiary">{Math.round(progress.progress)}% 完成</span>
                    </button>
                    <div
                      className="relative mx-1 h-7 overflow-hidden rounded-md border border-[color-mix(in_srgb,var(--accent)_34%,var(--border))] bg-accent-soft"
                      style={{ gridColumn: `${start + 1} / ${end + 2}` }}
                    >
                      <span
                        className="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]"
                        style={{ width: `${progress.progress}%` }}
                      />
                      <span className="relative flex h-full items-center truncate px-2 text-[11px] font-medium text-accent">
                        {PROJECT_STATUS_LABELS[project.status]}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
