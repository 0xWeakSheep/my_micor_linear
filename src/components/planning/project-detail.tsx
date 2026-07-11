"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import {
  Archive,
  ArrowLeft,
  CalendarDays,
  Flag,
  FolderKanban,
  Link2,
  Pencil,
  Plus,
  Save,
  Target,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type {
  Project,
  ProjectDependency,
  ProjectHealth,
  ProjectMilestone,
  ProjectStatus,
  ProjectUpdate,
} from "@/lib/domain";
import { calculateProjectProgress } from "@/modules/planning/progress";
import {
  EmptyPlanningState,
  formatPriority,
  formatPlanningDate,
  HealthBadge,
  HEALTH_LABELS,
  MemberAvatar,
  Metric,
  ProgressBar,
  PROJECT_STATUS_LABELS,
  StatusBadge,
} from "./shared";
import type { PlanningRouteProps } from "./types";

type ProjectTab = "overview" | "issues" | "updates";
type MilestoneDraft = Pick<ProjectMilestone, "name" | "description" | "targetDate"> & {
  id: string;
};
type ProjectEditDraft = Pick<
  Project,
  "name" | "summary" | "description" | "priority" | "startDate" | "targetDate" | "teamIds"
> & { leadId: string };

const PROJECT_STATUSES: ProjectStatus[] = [
  "planned",
  "started",
  "paused",
  "completed",
  "canceled",
];

const PROJECT_HEALTH: ProjectHealth[] = ["onTrack", "atRisk", "offTrack"];

export interface ProjectDetailProps extends PlanningRouteProps {
  projectId: string;
}

export function ProjectDetail({ projectId, onNavigate }: ProjectDetailProps) {
  const {
    data,
    mutate,
    setSelectedIssueId,
  } = useWorkspace();
  const [tab, setTab] = useState<ProjectTab>("overview");
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [milestoneName, setMilestoneName] = useState("");
  const [milestoneDate, setMilestoneDate] = useState("");
  const [milestoneDraft, setMilestoneDraft] = useState<MilestoneDraft | null>(null);
  const [dependencyProjectId, setDependencyProjectId] = useState("");
  const [updateBody, setUpdateBody] = useState("");
  const [updateHealth, setUpdateHealth] = useState<ProjectHealth>("onTrack");
  const [editDraft, setEditDraft] = useState<ProjectEditDraft | null>(null);
  const [isPending, startTransition] = useTransition();

  const project = data.projects.find((candidate) => candidate.id === projectId);
  const projectIssues = useMemo(
    () => data.issues.filter((issue) => issue.projectId === projectId && issue.trashedAt === null),
    [data.issues, projectId],
  );
  const milestones = useMemo(
    () =>
      data.milestones
        .filter((milestone) => milestone.projectId === projectId)
        .toSorted((left, right) => left.position - right.position),
    [data.milestones, projectId],
  );
  const dependencies = useMemo(
    () => data.projectDependencies.filter(
      (dependency) =>
        dependency.projectId === projectId || dependency.dependsOnProjectId === projectId,
    ),
    [data.projectDependencies, projectId],
  );
  const dependencyCandidates = useMemo(() => {
    const existing = new Set(
      dependencies
        .filter((dependency) => dependency.projectId === projectId)
        .map((dependency) => dependency.dependsOnProjectId),
    );
    return data.projects.filter(
      (candidate) => candidate.id !== projectId && !existing.has(candidate.id),
    );
  }, [data.projects, dependencies, projectId]);
  const updates = useMemo(
    () =>
      data.projectUpdates
        .filter((update) => update.projectId === projectId)
        .toSorted((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    [data.projectUpdates, projectId],
  );
  const progress = useMemo(
    () => calculateProjectProgress(projectId, data.issues, data.states),
    [data.issues, data.states, projectId],
  );
  const membershipByUser = useMemo(
    () => new Map(data.memberships.map((membership) => [membership.userId, membership])),
    [data.memberships],
  );
  const stateById = useMemo(
    () => new Map(data.states.map((state) => [state.id, state])),
    [data.states],
  );
  const teamById = useMemo(
    () => new Map(data.teams.map((team) => [team.id, team])),
    [data.teams],
  );
  const projectById = useMemo(
    () => new Map(data.projects.map((candidate) => [candidate.id, candidate])),
    [data.projects],
  );

  if (!project) {
    return (
      <section className="flex h-full min-h-0 flex-1 flex-col bg-background">
        <EmptyPlanningState
          title="找不到这个项目"
          description="项目可能已被删除，或者你没有查看权限。"
          action={
            <button
              type="button"
              onClick={() => onNavigate?.({ section: "projects", details: null })}
              className="h-8 rounded-md border border-border bg-surface px-3 text-xs font-medium text-primary hover:bg-surface-hover"
            >
              返回项目
            </button>
          }
        />
      </section>
    );
  }

  const currentProject = project;
  const latestUpdate = updates[0];

  function updateProjectStatus(status: ProjectStatus) {
    startTransition(async () => {
      await mutate<Project>(
        "project.update",
        { projectId, changes: { status } },
        { successMessage: "项目状态已更新" },
      );
    });
  }

  function beginProjectEdit() {
    setTab("overview");
    setEditDraft({
      name: currentProject.name,
      summary: currentProject.summary,
      description: currentProject.description,
      priority: currentProject.priority,
      leadId: currentProject.leadId ?? "",
      startDate: currentProject.startDate?.slice(0, 10) ?? null,
      targetDate: currentProject.targetDate?.slice(0, 10) ?? null,
      teamIds: [...currentProject.teamIds],
    });
  }

  function submitProjectEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editDraft?.name.trim() || editDraft.teamIds.length === 0) return;
    startTransition(async () => {
      const result = await mutate<Project>(
        "project.update",
        {
          projectId,
          changes: {
            name: editDraft.name.trim(),
            summary: editDraft.summary.trim(),
            description: editDraft.description,
            leadId: editDraft.leadId || null,
            priority: editDraft.priority,
            startDate: editDraft.startDate || null,
            targetDate: editDraft.targetDate || null,
            teamIds: editDraft.teamIds,
          },
        },
        { successMessage: "项目信息已更新" },
      );
      if (result) setEditDraft(null);
    });
  }

  function archiveProject() {
    if (!window.confirm(`归档项目“${currentProject.name}”？项目数据会保留，可从项目页的“归档项目”中恢复。`)) {
      return;
    }
    startTransition(async () => {
      const result = await mutate<Project>(
        "project.archive",
        { projectId },
        { successMessage: "项目已归档" },
      );
      if (result) onNavigate?.({ section: "projects", details: null });
    });
  }

  function submitMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!milestoneName.trim()) return;
    startTransition(async () => {
      const result = await mutate<ProjectMilestone>(
        "milestone.create",
        {
          projectId,
          name: milestoneName.trim(),
          targetDate: milestoneDate || null,
        },
        { successMessage: "里程碑已添加" },
      );
      if (result) {
        setMilestoneName("");
        setMilestoneDate("");
        setShowMilestoneForm(false);
      }
    });
  }

  function submitMilestoneEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!milestoneDraft?.name.trim()) return;
    startTransition(async () => {
      const result = await mutate<ProjectMilestone>(
        "milestone.update",
        {
          milestoneId: milestoneDraft.id,
          changes: {
            name: milestoneDraft.name.trim(),
            description: milestoneDraft.description,
            targetDate: milestoneDraft.targetDate || null,
          },
        },
        { successMessage: "里程碑已更新" },
      );
      if (result) setMilestoneDraft(null);
    });
  }

  function deleteMilestone(milestone: ProjectMilestone) {
    if (!window.confirm(`删除里程碑“${milestone.name}”？`)) return;
    startTransition(async () => {
      await mutate<boolean>(
        "milestone.delete",
        { milestoneId: milestone.id },
        { successMessage: "里程碑已删除" },
      );
    });
  }

  function createDependency() {
    if (!dependencyProjectId) return;
    startTransition(async () => {
      const result = await mutate<ProjectDependency>(
        "projectDependency.create",
        { projectId, dependsOnProjectId: dependencyProjectId },
        { successMessage: "项目依赖已添加" },
      );
      if (result) setDependencyProjectId("");
    });
  }

  function deleteDependency(dependencyId: string) {
    startTransition(async () => {
      await mutate<boolean>(
        "projectDependency.delete",
        { dependencyId },
        { successMessage: "项目依赖已移除" },
      );
    });
  }

  function submitUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!updateBody.trim()) return;
    startTransition(async () => {
      const result = await mutate<ProjectUpdate>(
        "projectUpdate.create",
        { projectId, health: updateHealth, body: updateBody.trim() },
        { successMessage: "项目更新已发布" },
      );
      if (result) setUpdateBody("");
    });
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-background" aria-labelledby="project-title">
      <header className="border-b border-border bg-surface">
        <div className="flex items-start gap-3 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => onNavigate?.({ section: "projects", details: null })}
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-surface-hover hover:text-primary"
            aria-label="返回项目列表"
          >
            <ArrowLeft size={16} strokeWidth={1.8} />
          </button>
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white"
            style={{ backgroundColor: project.color }}
            aria-hidden="true"
          >
            <FolderKanban size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 id="project-title" className="truncate text-base font-semibold tracking-tight text-primary">
                {project.name}
              </h1>
              <StatusBadge status={project.status} />
              <HealthBadge health={latestUpdate?.health ?? null} />
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-secondary">
              {project.summary || "尚未填写项目简介"}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => editDraft ? setEditDraft(null) : beginProjectEdit()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-subtle px-2.5 text-xs font-medium text-primary transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              {editDraft ? <X size={13} /> : <Pencil size={13} />}
              {editDraft ? "取消编辑" : "编辑"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={archiveProject}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-subtle px-2.5 text-xs font-medium text-secondary transition-colors hover:bg-surface-hover hover:text-primary disabled:opacity-50"
            >
              <Archive size={13} />
              <span className="hidden sm:inline">归档</span>
            </button>
            <label className="flex items-center gap-2 text-xs text-secondary">
              <span className="hidden sm:inline">状态</span>
              <select
                value={project.status}
                disabled={isPending}
                onChange={(event) => updateProjectStatus(event.target.value as ProjectStatus)}
                className="h-8 rounded-md border border-border bg-surface-subtle px-2 text-xs text-primary outline-none focus:border-accent"
                aria-label="更新项目状态"
              >
                {PROJECT_STATUSES.map((status) => (
                  <option key={status} value={status}>{PROJECT_STATUS_LABELS[status]}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-4 sm:px-6" aria-label="项目详情">
          {([
            ["overview", "概览"],
            ["issues", `Issue ${projectIssues.length}`],
            ["updates", `更新 ${updates.length}`],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              aria-current={tab === value ? "page" : undefined}
              className={`relative h-9 whitespace-nowrap px-2.5 text-xs font-medium transition-colors ${
                tab === value ? "text-primary" : "text-secondary hover:text-primary"
              }`}
            >
              {label}
              {tab === value ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-accent" /> : null}
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {editDraft ? (
          <ProjectEditForm
            draft={editDraft}
            setDraft={setEditDraft}
            memberships={data.memberships}
            teams={data.teams}
            onSubmit={submitProjectEdit}
            onCancel={() => setEditDraft(null)}
            isPending={isPending}
          />
        ) : tab === "overview" ? (
          <ProjectOverview
            project={project}
            progress={progress}
            milestones={milestones}
            dependencies={dependencies}
            dependencyCandidates={dependencyCandidates}
            latestUpdate={latestUpdate}
            membershipByUser={membershipByUser}
            teamById={teamById}
            projectById={projectById}
            showMilestoneForm={showMilestoneForm}
            setShowMilestoneForm={setShowMilestoneForm}
            milestoneName={milestoneName}
            setMilestoneName={setMilestoneName}
            milestoneDate={milestoneDate}
            setMilestoneDate={setMilestoneDate}
            submitMilestone={submitMilestone}
            milestoneDraft={milestoneDraft}
            setMilestoneDraft={setMilestoneDraft}
            submitMilestoneEdit={submitMilestoneEdit}
            deleteMilestone={deleteMilestone}
            dependencyProjectId={dependencyProjectId}
            setDependencyProjectId={setDependencyProjectId}
            createDependency={createDependency}
            deleteDependency={deleteDependency}
            isPending={isPending}
          />
        ) : tab === "issues" ? (
          projectIssues.length === 0 ? (
            <EmptyPlanningState
              title="项目中还没有 Issue"
              description="从 Issue 详情中选择这个项目，相关工作会显示在这里。"
            />
          ) : (
            <div className="min-w-[680px]">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 bg-panel text-[11px] font-medium text-tertiary">
                  <tr className="border-b border-border">
                    <th scope="col" className="w-28 px-4 py-2.5 sm:px-6">ID</th>
                    <th scope="col" className="px-3 py-2.5">标题</th>
                    <th scope="col" className="px-3 py-2.5">状态</th>
                    <th scope="col" className="px-3 py-2.5">负责人</th>
                    <th scope="col" className="px-3 py-2.5">估算</th>
                  </tr>
                </thead>
                <tbody>
                  {projectIssues.map((issue) => {
                    const state = stateById.get(issue.statusId);
                    return (
                      <tr key={issue.id} className="border-b border-border/80 hover:bg-surface-hover">
                        <td className="px-4 py-2.5 font-mono text-xs text-tertiary sm:px-6">{issue.identifier}</td>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => setSelectedIssueId(issue.id)}
                            className="block max-w-[560px] truncate text-left text-sm text-primary hover:underline"
                          >
                            {issue.title}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-secondary">{state?.name ?? "未知"}</td>
                        <td className="px-3 py-2.5"><MemberAvatar membership={membershipByUser.get(issue.assigneeId ?? "")} size="sm" /></td>
                        <td className="px-3 py-2.5 font-mono text-xs text-secondary">{issue.estimate ?? "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <ProjectUpdates
            updates={updates}
            membershipByUser={membershipByUser}
            updateBody={updateBody}
            setUpdateBody={setUpdateBody}
            updateHealth={updateHealth}
            setUpdateHealth={setUpdateHealth}
            submitUpdate={submitUpdate}
            isPending={isPending}
          />
        )}
      </div>
    </section>
  );
}

interface ProjectEditFormProps {
  draft: ProjectEditDraft;
  setDraft: (draft: ProjectEditDraft) => void;
  memberships: ReturnType<typeof useWorkspace>["data"]["memberships"];
  teams: ReturnType<typeof useWorkspace>["data"]["teams"];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  isPending: boolean;
}

function ProjectEditForm({
  draft,
  setDraft,
  memberships,
  teams,
  onSubmit,
  onCancel,
  isPending,
}: ProjectEditFormProps) {
  const invalidDateRange = Boolean(
    draft.startDate && draft.targetDate && draft.targetDate < draft.startDate,
  );
  const activeMemberships = memberships.filter((membership) => membership.status === "active");
  const unavailableLead = draft.leadId &&
    !activeMemberships.some((membership) => membership.userId === draft.leadId);

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-5xl p-4 sm:p-6" aria-labelledby="project-edit-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 id="project-edit-heading" className="text-base font-semibold text-primary">编辑项目信息</h2>
          <p className="mt-1 text-xs text-secondary">维护项目范围、负责人和计划日期。</p>
        </div>
        <span className="text-[11px] text-tertiary" aria-live="polite">{isPending ? "保存中…" : ""}</span>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <label className="grid gap-1.5 text-xs font-medium text-secondary">
            名称
            <input
              autoFocus
              value={draft.name}
              disabled={isPending}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-primary outline-none transition-colors focus:border-accent disabled:opacity-60"
              maxLength={200}
              required
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-secondary">
            简介
            <input
              value={draft.summary}
              disabled={isPending}
              onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-primary outline-none transition-colors focus:border-accent disabled:opacity-60"
              maxLength={1_000}
              placeholder="一句话说明项目目标"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-secondary">
            说明
            <textarea
              value={draft.description}
              disabled={isPending}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              className="min-h-44 resize-y rounded-md border border-border bg-surface px-3 py-2.5 text-sm leading-6 text-primary outline-none transition-colors focus:border-accent disabled:opacity-60"
              maxLength={100_000}
              placeholder="记录背景、范围与成功标准…"
            />
          </label>
        </div>

        <aside className="space-y-4 lg:border-l lg:border-border lg:pl-5" aria-label="项目编辑属性">
          <label className="grid gap-1.5 text-xs font-medium text-secondary">
            Lead
            <select
              value={draft.leadId}
              disabled={isPending}
              onChange={(event) => setDraft({ ...draft, leadId: event.target.value })}
              className="h-9 rounded-md border border-border bg-surface px-2.5 text-xs text-primary outline-none focus:border-accent disabled:opacity-60"
            >
              <option value="">未指派</option>
              {unavailableLead ? <option value={draft.leadId}>当前负责人（不可用）</option> : null}
              {activeMemberships.map((membership) => (
                <option key={membership.userId} value={membership.userId}>{membership.user.name}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-secondary">
            优先级
            <select
              value={draft.priority}
              disabled={isPending}
              onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) as Project["priority"] })}
              className="h-9 rounded-md border border-border bg-surface px-2.5 text-xs text-primary outline-none focus:border-accent disabled:opacity-60"
            >
              {([0, 1, 2, 3, 4] as const).map((priority) => (
                <option key={priority} value={priority}>{formatPriority(priority)}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            <label className="grid gap-1.5 text-xs font-medium text-secondary">
              开始日期
              <input
                type="date"
                value={draft.startDate ?? ""}
                disabled={isPending}
                onChange={(event) => setDraft({ ...draft, startDate: event.target.value || null })}
                className="h-9 min-w-0 rounded-md border border-border bg-surface px-2.5 text-xs text-primary outline-none focus:border-accent disabled:opacity-60"
              />
            </label>
            <label className="grid gap-1.5 text-xs font-medium text-secondary">
              目标日期
              <input
                type="date"
                value={draft.targetDate ?? ""}
                disabled={isPending}
                onChange={(event) => setDraft({ ...draft, targetDate: event.target.value || null })}
                className="h-9 min-w-0 rounded-md border border-border bg-surface px-2.5 text-xs text-primary outline-none focus:border-accent disabled:opacity-60"
              />
            </label>
          </div>
          {invalidDateRange ? <p className="text-xs text-danger">目标日期不能早于开始日期。</p> : null}
          <fieldset className="space-y-2" disabled={isPending}>
            <legend className="text-xs font-medium text-secondary">团队</legend>
            <div className="max-h-44 space-y-1 overflow-auto rounded-md border border-border bg-surface p-2">
              {teams.map((team) => {
                const checked = draft.teamIds.includes(team.id);
                return (
                  <label key={team.id} className="flex min-h-8 items-center gap-2 rounded px-1.5 text-xs text-secondary hover:bg-surface-hover">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const teamIds = checked
                          ? draft.teamIds.length === 1
                            ? draft.teamIds
                            : draft.teamIds.filter((teamId) => teamId !== team.id)
                          : [...draft.teamIds, team.id];
                        setDraft({ ...draft, teamIds });
                      }}
                      className="size-3.5 accent-[var(--accent)]"
                    />
                    <span className="size-2 rounded-full" style={{ backgroundColor: team.color }} />
                    <span className="truncate">{team.name}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-[11px] text-tertiary">项目至少需要关联一个团队。</p>
          </fieldset>
        </aside>
      </div>

      <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" onClick={onCancel} disabled={isPending} className="h-9 rounded-md border border-border bg-surface px-3 text-xs font-medium text-secondary hover:bg-surface-hover disabled:opacity-50">取消</button>
        <button type="submit" disabled={isPending || !draft.name.trim() || draft.teamIds.length === 0 || invalidDateRange} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50">
          <Save size={13} /> 保存项目
        </button>
      </div>
    </form>
  );
}

interface ProjectOverviewProps {
  project: Project;
  progress: ReturnType<typeof calculateProjectProgress>;
  milestones: ProjectMilestone[];
  dependencies: ProjectDependency[];
  dependencyCandidates: Project[];
  latestUpdate: ProjectUpdate | undefined;
  membershipByUser: Map<string, ReturnType<typeof useWorkspace>["data"]["memberships"][number]>;
  teamById: Map<string, ReturnType<typeof useWorkspace>["data"]["teams"][number]>;
  projectById: Map<string, Project>;
  showMilestoneForm: boolean;
  setShowMilestoneForm: (value: boolean) => void;
  milestoneName: string;
  setMilestoneName: (value: string) => void;
  milestoneDate: string;
  setMilestoneDate: (value: string) => void;
  submitMilestone: (event: FormEvent<HTMLFormElement>) => void;
  milestoneDraft: MilestoneDraft | null;
  setMilestoneDraft: (value: MilestoneDraft | null) => void;
  submitMilestoneEdit: (event: FormEvent<HTMLFormElement>) => void;
  deleteMilestone: (milestone: ProjectMilestone) => void;
  dependencyProjectId: string;
  setDependencyProjectId: (value: string) => void;
  createDependency: () => void;
  deleteDependency: (dependencyId: string) => void;
  isPending: boolean;
}

function ProjectOverview({
  project,
  progress,
  milestones,
  dependencies,
  dependencyCandidates,
  latestUpdate,
  membershipByUser,
  teamById,
  projectById,
  showMilestoneForm,
  setShowMilestoneForm,
  milestoneName,
  setMilestoneName,
  milestoneDate,
  setMilestoneDate,
  submitMilestone,
  milestoneDraft,
  setMilestoneDraft,
  submitMilestoneEdit,
  deleteMilestone,
  dependencyProjectId,
  setDependencyProjectId,
  createDependency,
  deleteDependency,
  isPending,
}: ProjectOverviewProps) {
  return (
    <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 space-y-6">
        <section aria-labelledby="project-progress-heading" className="rounded-md border border-border bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="project-progress-heading" className="text-sm font-medium text-primary">项目进度</h2>
              <p className="mt-1 text-xs text-secondary">按 Estimate effort 计算，未估算项按 1 计</p>
            </div>
            <span className="font-mono text-2xl font-medium tracking-tight text-primary">{Math.round(progress.progress)}%</span>
          </div>
          <ProgressBar value={progress.progress} label={`${project.name} 进度`} className="mt-4" />
          <div className="mt-5 grid grid-cols-4 gap-3">
            <Metric label="范围" value={progress.totalIssues} detail="Issue" />
            <Metric label="已完成" value={progress.completedIssues} />
            <Metric label="总投入" value={progress.totalEffort} detail="Points" />
            <Metric label="剩余" value={progress.remainingEffort} detail="Points" />
          </div>
        </section>

        <section aria-labelledby="project-description-heading">
          <h2 id="project-description-heading" className="text-sm font-medium text-primary">项目说明</h2>
          <div className="mt-2 min-h-24 whitespace-pre-wrap rounded-md border border-border bg-surface px-4 py-3 text-sm leading-6 text-secondary">
            {project.description || project.summary || "尚未填写详细说明。"}
          </div>
        </section>

        <section aria-labelledby="milestones-heading">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="milestones-heading" className="text-sm font-medium text-primary">里程碑</h2>
              <p className="mt-0.5 text-xs text-secondary">标记项目中的关键交付节点</p>
            </div>
            <button
              type="button"
              onClick={() => setShowMilestoneForm(!showMilestoneForm)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-primary hover:bg-surface-hover"
            >
              <Plus size={13} /> 添加
            </button>
          </div>
          {showMilestoneForm ? (
            <form onSubmit={submitMilestone} className="mt-3 grid gap-2 rounded-md border border-border bg-panel p-3 sm:grid-cols-[1fr_160px_auto]">
              <input
                autoFocus
                value={milestoneName}
                onChange={(event) => setMilestoneName(event.target.value)}
                placeholder="里程碑名称"
                aria-label="里程碑名称"
                className="h-8 rounded-md border border-border bg-surface px-2.5 text-xs outline-none focus:border-accent"
                required
              />
              <input
                type="date"
                value={milestoneDate}
                onChange={(event) => setMilestoneDate(event.target.value)}
                aria-label="里程碑目标日期"
                className="h-8 rounded-md border border-border bg-surface px-2.5 text-xs outline-none focus:border-accent"
              />
              <button type="submit" disabled={isPending || !milestoneName.trim()} className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50">
                保存
              </button>
            </form>
          ) : null}
          <div className="mt-3 overflow-hidden rounded-md border border-border bg-surface">
            {milestones.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-tertiary">尚未设置里程碑</p>
            ) : (
              <ol>
                {milestones.map((milestone, index) => (
                  <li key={milestone.id} className="border-b border-border px-4 py-3 last:border-b-0">
                    {milestoneDraft?.id === milestone.id ? (
                      <form onSubmit={submitMilestoneEdit} className="grid gap-2 sm:grid-cols-[1fr_160px_auto]">
                        <div className="grid gap-2">
                          <input
                            autoFocus
                            value={milestoneDraft.name}
                            onChange={(event) => setMilestoneDraft({ ...milestoneDraft, name: event.target.value })}
                            aria-label="编辑里程碑名称"
                            className="h-8 rounded-md border border-border bg-panel px-2.5 text-xs outline-none focus:border-accent"
                            required
                          />
                          <input
                            value={milestoneDraft.description}
                            onChange={(event) => setMilestoneDraft({ ...milestoneDraft, description: event.target.value })}
                            aria-label="编辑里程碑说明"
                            placeholder="里程碑说明"
                            className="h-8 rounded-md border border-border bg-panel px-2.5 text-xs outline-none focus:border-accent"
                          />
                        </div>
                        <input
                          type="date"
                          value={milestoneDraft.targetDate ?? ""}
                          onChange={(event) => setMilestoneDraft({ ...milestoneDraft, targetDate: event.target.value || null })}
                          aria-label="编辑里程碑目标日期"
                          className="h-8 rounded-md border border-border bg-panel px-2.5 text-xs outline-none focus:border-accent"
                        />
                        <div className="flex items-start gap-1">
                          <button type="submit" disabled={isPending || !milestoneDraft.name.trim()} className="h-8 rounded-md bg-accent px-2.5 text-xs font-medium text-white disabled:opacity-50">保存</button>
                          <button type="button" onClick={() => setMilestoneDraft(null)} className="h-8 rounded-md border border-border px-2.5 text-xs text-secondary">取消</button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex gap-3">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                          <Target size={13} strokeWidth={1.8} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-primary">{milestone.name}</p>
                            <span className="text-xs text-tertiary">{formatPlanningDate(milestone.targetDate)}</span>
                          </div>
                          <p className="mt-0.5 text-xs leading-5 text-secondary">{milestone.description || `项目节点 ${index + 1}`}</p>
                        </div>
                        <div className="flex shrink-0 items-start gap-1">
                          <button
                            type="button"
                            onClick={() => setMilestoneDraft({ id: milestone.id, name: milestone.name, description: milestone.description, targetDate: milestone.targetDate })}
                            aria-label={`编辑里程碑 ${milestone.name}`}
                            className="flex h-7 w-7 items-center justify-center rounded text-tertiary hover:bg-surface-hover hover:text-primary"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteMilestone(milestone)}
                            aria-label={`删除里程碑 ${milestone.name}`}
                            className="flex h-7 w-7 items-center justify-center rounded text-tertiary hover:bg-danger-soft hover:text-danger"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <section aria-labelledby="project-dependencies-heading">
          <div>
            <h2 id="project-dependencies-heading" className="text-sm font-medium text-primary">项目依赖</h2>
            <p className="mt-0.5 text-xs text-secondary">维护当前项目的前置依赖与阻塞关系</p>
          </div>
          <div className="mt-3 flex gap-2">
            <select
              value={dependencyProjectId}
              onChange={(event) => setDependencyProjectId(event.target.value)}
              aria-label="选择依赖项目"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 text-xs text-primary outline-none focus:border-accent"
            >
              <option value="">选择前置项目</option>
              {dependencyCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={createDependency}
              disabled={isPending || !dependencyProjectId}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-medium text-white disabled:opacity-50"
            >
              <Plus size={13} /> 添加依赖
            </button>
          </div>
          <div className="mt-3 overflow-hidden rounded-md border border-border bg-surface">
            {dependencies.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-tertiary">尚无项目依赖</p>
            ) : (
              <ul>
                {dependencies.map((dependency) => {
                  const isBlockedBy = dependency.projectId === project.id;
                  const relatedId = isBlockedBy
                    ? dependency.dependsOnProjectId
                    : dependency.projectId;
                  return (
                    <li key={dependency.id} className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
                      <Link2 size={13} className="shrink-0 text-tertiary" />
                      <span className="w-20 shrink-0 text-[11px] font-medium text-tertiary">
                        {isBlockedBy ? "依赖于" : "阻塞"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-primary">
                        {projectById.get(relatedId)?.name ?? "不可见项目"}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteDependency(dependency.id)}
                        aria-label={`移除项目依赖 ${projectById.get(relatedId)?.name ?? relatedId}`}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-tertiary hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      <aside className="space-y-5 lg:border-l lg:border-border lg:pl-5" aria-label="项目属性">
        <div>
          <p className="text-xs font-medium text-tertiary">负责人</p>
          <div className="mt-2 flex items-center gap-2">
            <MemberAvatar membership={membershipByUser.get(project.leadId ?? "")} />
            <span className="truncate text-sm text-primary">{membershipByUser.get(project.leadId ?? "")?.user.name ?? "未指派"}</span>
          </div>
        </div>
        <Property icon={<Flag size={14} />} label="优先级" value={formatPriority(project.priority)} />
        <Property icon={<CalendarDays size={14} />} label="开始日期" value={formatPlanningDate(project.startDate)} />
        <Property icon={<Target size={14} />} label="目标日期" value={formatPlanningDate(project.targetDate)} />
        <div>
          <p className="flex items-center gap-2 text-xs font-medium text-tertiary"><Users size={14} /> 团队</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {project.teamIds.map((teamId) => (
              <span key={teamId} className="rounded-md bg-surface-subtle px-2 py-1 text-xs text-secondary">{teamById.get(teamId)?.name ?? "未知团队"}</span>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-tertiary">最新健康状态</p>
          <div className="mt-2"><HealthBadge health={latestUpdate?.health ?? null} /></div>
        </div>
      </aside>
    </div>
  );
}

function Property({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <p className="flex items-center gap-2 text-xs font-medium text-tertiary">{icon} {label}</p>
      <p className="mt-1.5 text-sm text-primary">{value}</p>
    </div>
  );
}

interface ProjectUpdatesProps {
  updates: ProjectUpdate[];
  membershipByUser: Map<string, ReturnType<typeof useWorkspace>["data"]["memberships"][number]>;
  updateBody: string;
  setUpdateBody: (value: string) => void;
  updateHealth: ProjectHealth;
  setUpdateHealth: (value: ProjectHealth) => void;
  submitUpdate: (event: FormEvent<HTMLFormElement>) => void;
  isPending: boolean;
}

function ProjectUpdates({
  updates,
  membershipByUser,
  updateBody,
  setUpdateBody,
  updateHealth,
  setUpdateHealth,
  submitUpdate,
  isPending,
}: ProjectUpdatesProps) {
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <form onSubmit={submitUpdate} className="rounded-md border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="project-update" className="text-sm font-medium text-primary">发布项目更新</label>
          <select
            value={updateHealth}
            onChange={(event) => setUpdateHealth(event.target.value as ProjectHealth)}
            className="h-8 rounded-md border border-border bg-surface-subtle px-2 text-xs outline-none focus:border-accent"
            aria-label="项目健康状态"
          >
            {PROJECT_HEALTH.map((health) => <option key={health} value={health}>{HEALTH_LABELS[health]}</option>)}
          </select>
        </div>
        <textarea
          id="project-update"
          value={updateBody}
          onChange={(event) => setUpdateBody(event.target.value)}
          rows={4}
          placeholder="记录本周进展、风险和下一步计划"
          className="mt-3 w-full resize-y rounded-md border border-border bg-panel px-3 py-2 text-sm leading-6 outline-none focus:border-accent"
          required
        />
        <div className="mt-3 flex justify-end">
          <button type="submit" disabled={isPending || !updateBody.trim()} className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50">
            {isPending ? "发布中" : "发布更新"}
          </button>
        </div>
      </form>

      <div className="mt-6 space-y-3">
        {updates.length === 0 ? (
          <EmptyPlanningState title="还没有项目更新" description="发布第一条更新，让团队了解当前健康状态和下一步计划。" />
        ) : (
          updates.map((update) => {
            const author = membershipByUser.get(update.authorId);
            return (
              <article key={update.id} className="rounded-md border border-border bg-surface p-4">
                <header className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <MemberAvatar membership={author} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-primary">{author?.user.name ?? "未知成员"}</p>
                      <p className="text-[11px] text-tertiary">{formatPlanningDate(update.createdAt)}</p>
                    </div>
                  </div>
                  <HealthBadge health={update.health} />
                </header>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-secondary">{update.body}</p>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
