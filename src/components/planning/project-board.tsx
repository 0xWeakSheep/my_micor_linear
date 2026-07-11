"use client";

import { useMemo, useState } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, LoaderCircle } from "lucide-react";

import { useWorkspace } from "@/components/workspace/workspace-provider";
import type { BootstrapData, Project, ProjectStatus } from "@/lib/domain";
import type { ProgressSummary } from "@/modules/planning/progress";
import { cn } from "@/lib/utils";
import {
  formatPriority,
  MemberAvatar,
  ProgressBar,
  PROJECT_STATUS_LABELS,
} from "./shared";

export const PROJECT_BOARD_STATUSES: ProjectStatus[] = [
  "planned",
  "started",
  "paused",
  "completed",
  "canceled",
];

const announcements: Announcements = {
  onDragStart({ active }) {
    return `已拿起项目 ${String(active.data.current?.name ?? "项目")}。`;
  },
  onDragOver({ active, over }) {
    if (!over) return `${String(active.data.current?.name ?? "项目")} 当前没有可用落点。`;
    return `${String(active.data.current?.name ?? "项目")} 位于 ${String(over.data.current?.label ?? "目标状态")} 上方。`;
  },
  onDragEnd({ active, over }) {
    if (!over) return `${String(active.data.current?.name ?? "项目")} 未移动。`;
    return `${String(active.data.current?.name ?? "项目")} 已放到 ${String(over.data.current?.label ?? "目标状态")}。`;
  },
  onDragCancel({ active }) {
    return `已取消移动项目 ${String(active.data.current?.name ?? "项目")}。`;
  },
};

interface ProjectBoardProps {
  projects: Project[];
  progressByProject: ReadonlyMap<string, ProgressSummary>;
  onOpen: (projectId: string) => void;
}

export function ProjectBoard({ projects, progressByProject, onOpen }: ProjectBoardProps) {
  const { data, mutate } = useWorkspace();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [pendingProjectIds, setPendingProjectIds] = useState<Set<string>>(() => new Set());
  const [statusOverrides, setStatusOverrides] = useState<Map<string, { status: ProjectStatus; sourceUpdatedAt: string }>>(
    () => new Map(),
  );
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const canEdit = data.currentMembership?.role !== "guest";
  const membershipByUser = useMemo(
    () => new Map(data.memberships.map((membership) => [membership.userId, membership])),
    [data.memberships],
  );
  const teamById = useMemo(
    () => new Map(data.teams.map((team) => [team.id, team])),
    [data.teams],
  );
  const visibleProjects = useMemo(
    () => projects.map((project) => {
      const override = statusOverrides.get(project.id);
      const isAwaitingServerState =
        override &&
        project.updatedAt === override.sourceUpdatedAt &&
        project.status !== override.status;
      return isAwaitingServerState ? { ...project, status: override.status } : project;
    }),
    [projects, statusOverrides],
  );
  const activeProject = visibleProjects.find((project) => project.id === activeProjectId);

  function handleDragStart(event: DragStartEvent) {
    setActiveProjectId(String(event.active.id));
    setMoveAnnouncement("");
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveProjectId(null);
    const projectId = String(event.active.id);
    const project = visibleProjects.find((candidate) => candidate.id === projectId);
    const status = event.over?.data.current?.status;
    if (!project || !PROJECT_BOARD_STATUSES.includes(status as ProjectStatus)) {
      setMoveAnnouncement("未检测到目标项目状态，项目没有移动。");
      return;
    }
    const nextStatus = status as ProjectStatus;
    const targetLabel = PROJECT_STATUS_LABELS[nextStatus];
    if (project.status === nextStatus) {
      setMoveAnnouncement(`${project.name} 已在${targetLabel}，状态未改变。`);
      return;
    }

    setStatusOverrides((current) => new Map(current).set(projectId, {
      status: nextStatus,
      sourceUpdatedAt: project.updatedAt,
    }));
    setPendingProjectIds((current) => new Set(current).add(projectId));
    const result = await mutate<Project>(
      "project.update",
      { projectId, changes: { status: nextStatus } },
      { successMessage: `${project.name} 已移至${targetLabel}` },
    );
    if (!result) {
      setStatusOverrides((current) => {
        const next = new Map(current);
        next.delete(projectId);
        return next;
      });
    }
    setPendingProjectIds((current) => {
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
    setMoveAnnouncement(
      result
        ? `${project.name} 已移至${targetLabel}。`
        : `${project.name} 移动失败，已恢复原状态。`,
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: "按空格键拿起项目，使用方向键选择状态，再按空格键放下。按 Esc 取消。",
        },
      }}
      onDragStart={handleDragStart}
      onDragEnd={(event) => void handleDragEnd(event)}
      onDragCancel={() => {
        setActiveProjectId(null);
        setMoveAnnouncement("已取消移动，项目状态未改变。");
      }}
    >
      <p className="sr-only" role="status" aria-live="polite">{moveAnnouncement}</p>
      <div className="grid min-h-full auto-cols-[280px] grid-flow-col gap-3 overflow-x-auto p-4 sm:p-6" aria-label="项目看板">
        {PROJECT_BOARD_STATUSES.map((status) => (
          <ProjectColumn
            key={status}
            status={status}
            projects={visibleProjects.filter((project) => project.status === status)}
            progressByProject={progressByProject}
            membershipByUser={membershipByUser}
            teamById={teamById}
            pendingProjectIds={pendingProjectIds}
            canEdit={canEdit}
            onOpen={onOpen}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: "ease" }}>
        {activeProject ? (
          <div className="w-[264px] rotate-[1deg] rounded-md border border-border-strong bg-surface p-3 text-sm font-medium text-primary shadow-[var(--shadow-popover)]">
            {activeProject.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function ProjectColumn({
  status,
  projects,
  progressByProject,
  membershipByUser,
  teamById,
  pendingProjectIds,
  canEdit,
  onOpen,
}: {
  status: ProjectStatus;
  projects: Project[];
  progressByProject: ReadonlyMap<string, ProgressSummary>;
  membershipByUser: Map<string, BootstrapData["memberships"][number]>;
  teamById: Map<string, BootstrapData["teams"][number]>;
  pendingProjectIds: ReadonlySet<string>;
  canEdit: boolean;
  onOpen: (projectId: string) => void;
}) {
  const label = PROJECT_STATUS_LABELS[status];
  const { setNodeRef, isOver } = useDroppable({
    id: `project-status:${status}`,
    data: { status, label },
    disabled: !canEdit,
  });

  return (
    <section
      ref={setNodeRef}
      aria-label={`项目状态 ${label}`}
      data-project-column={status}
      className={cn(
        "min-w-0 rounded-lg border border-transparent p-1 transition-[border-color,background-color,box-shadow] duration-150",
        isOver && "border-accent bg-accent-soft shadow-[0_0_0_1px_var(--accent)]",
      )}
    >
      <div className="mb-2 flex h-8 items-center justify-between px-1">
        <h2 className="text-xs font-medium text-secondary">{label}</h2>
        {isOver ? (
          <span className="text-[10px] font-medium text-accent">释放以移动</span>
        ) : (
          <span className="font-mono text-[11px] text-tertiary">{projects.length}</span>
        )}
      </div>
      <div className="space-y-2">
        {projects.map((project) => {
          const progress = progressByProject.get(project.id);
          const teamNames = project.teamIds
            .map((teamId) => teamById.get(teamId)?.name)
            .filter(Boolean)
            .join(", ");
          return (
            <DraggableProjectCard
              key={project.id}
              project={project}
              progress={progress?.progress ?? 0}
              teamNames={teamNames}
              lead={membershipByUser.get(project.leadId ?? "")}
              pending={pendingProjectIds.has(project.id)}
              disabled={!canEdit}
              onOpen={() => onOpen(project.id)}
            />
          );
        })}
        {projects.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-xs text-tertiary">
            {isOver ? "释放以移动到这里" : "暂无项目"}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DraggableProjectCard({
  project,
  progress,
  teamNames,
  lead,
  pending,
  disabled,
  onOpen,
}: {
  project: Project;
  progress: number;
  teamNames: string;
  lead: BootstrapData["memberships"][number] | undefined;
  pending: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: project.id,
    data: { name: project.name },
    disabled: disabled || pending,
  });

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "group rounded-md border border-border bg-surface p-3 transition-[border-color,background-color,opacity] duration-150 hover:border-border-strong hover:bg-surface-hover",
        isDragging && "opacity-20",
        pending && "border-accent/60",
      )}
      aria-busy={pending}
      data-project-card={project.id}
    >
      <div className="flex items-start gap-1.5">
        <ProjectDragHandle
          project={project}
          pending={pending}
          disabled={disabled}
          attributes={attributes}
          listeners={listeners}
          setActivatorNodeRef={setActivatorNodeRef}
        />
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <span className="flex items-start justify-between gap-3">
            <span className="line-clamp-2 text-sm font-medium leading-5 text-primary">{project.name}</span>
            <MemberAvatar membership={lead} size="sm" />
          </span>
          <span className="mt-1.5 line-clamp-2 text-xs leading-5 text-secondary">
            {project.summary || "暂无项目简介"}
          </span>
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <ProgressBar value={progress} label={`${project.name} 进度`} className="flex-1" />
        <span className="font-mono text-[11px] text-tertiary">{Math.round(progress)}%</span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-tertiary">
        <span className="truncate">{teamNames || "未关联团队"}</span>
        <span>{formatPriority(project.priority)}</span>
      </div>
    </article>
  );
}

function ProjectDragHandle({
  project,
  pending,
  disabled,
  attributes,
  listeners,
  setActivatorNodeRef,
}: {
  project: Project;
  pending: boolean;
  disabled: boolean;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  setActivatorNodeRef: (element: HTMLElement | null) => void;
}) {
  return (
    <button
      ref={setActivatorNodeRef}
      type="button"
      disabled={disabled || pending}
      className="-ml-2 -mt-2 grid size-10 shrink-0 touch-none place-items-center rounded text-tertiary opacity-70 transition-[color,background-color,opacity,transform] hover:bg-surface-active hover:text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 md:-ml-1 md:-mt-1 md:size-7 md:cursor-grab md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 md:active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={pending ? `正在保存项目 ${project.name}` : `拖动项目 ${project.name}`}
      title={disabled ? "只读成员不能修改项目状态" : pending ? "正在保存状态" : "拖动以改变状态"}
      {...attributes}
      {...listeners}
    >
      {pending ? <LoaderCircle size={14} className="animate-spin" /> : <GripVertical size={14} />}
    </button>
  );
}
