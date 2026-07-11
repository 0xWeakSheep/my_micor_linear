import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DragEndEvent } from "@dnd-kit/core";

import type { BootstrapData, Project, ProjectStatus } from "@/lib/domain";
import type { ProgressSummary } from "@/modules/planning/progress";

interface MockDndContextProps {
  onDragEnd?: (event: DragEndEvent) => void;
  children?: React.ReactNode;
}

const dnd = vi.hoisted(() => ({
  contextProps: null as MockDndContextProps | null,
  droppables: new Map<string, { disabled: boolean }>(),
}));

const workspace = vi.hoisted(() => ({ useWorkspace: vi.fn() }));

vi.mock("@/components/workspace/workspace-provider", () => ({
  useWorkspace: workspace.useWorkspace,
}));

vi.mock("@dnd-kit/core", async () => {
  const React = await import("react");
  class MouseSensor {}
  class TouchSensor {}
  class KeyboardSensor {}
  return {
    MouseSensor,
    TouchSensor,
    KeyboardSensor,
    closestCorners: vi.fn(),
    DndContext: (props: MockDndContextProps) => {
      dnd.contextProps = props;
      return React.createElement(React.Fragment, null, props.children);
    },
    DragOverlay: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useSensor: (sensor: unknown, options?: unknown) => ({ sensor, options }),
    useSensors: (...sensors: unknown[]) => sensors,
    useDroppable: ({ id, disabled = false }: { id: string; disabled?: boolean }) => {
      dnd.droppables.set(String(id), { disabled });
      return { setNodeRef: vi.fn(), isOver: false };
    },
    useDraggable: ({ disabled = false }: { disabled?: boolean }) => ({
      attributes: {
        role: "button",
        tabIndex: 0,
        "aria-disabled": disabled,
        "aria-pressed": false,
        "aria-roledescription": "draggable",
        "aria-describedby": "drag-description",
      },
      listeners: { onKeyDown: vi.fn() },
      setNodeRef: vi.fn(),
      setActivatorNodeRef: vi.fn(),
      transform: null,
      isDragging: false,
    }),
  };
});

vi.mock("@dnd-kit/sortable", () => ({ sortableKeyboardCoordinates: vi.fn() }));
vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Translate: { toString: () => undefined } },
}));

import { ProjectBoard } from "./project-board";

function project(status: ProjectStatus = "planned"): Project {
  return {
    id: "project_1",
    workspaceId: "workspace_1",
    teamId: "team_1",
    name: "Launch mobile navigation",
    slug: "launch-mobile-navigation",
    summary: "Ship the new mobile navigation.",
    description: "",
    status,
    priority: 2,
    leadId: null,
    color: "#5e6ad2",
    icon: "P",
    startDate: null,
    targetDate: null,
    archivedAt: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    teamIds: ["team_1"],
    memberIds: [],
  };
}

function data(): BootstrapData {
  return {
    currentMembership: { role: "admin" },
    memberships: [],
    teams: [{ id: "team_1", name: "Engineering" }],
  } as unknown as BootstrapData;
}

const progress = {
  totalIssues: 1,
  completedIssues: 0,
  activeIssues: 1,
  canceledIssues: 0,
  totalEffort: 1,
  completedEffort: 0,
  remainingEffort: 1,
  issueProgress: 0,
  effortProgress: 0,
  progress: 0,
} satisfies ProgressSummary;

function drop(projectId: string, status: ProjectStatus): DragEndEvent {
  return {
    active: { id: projectId },
    over: {
      id: `project-status:${status}`,
      data: { current: { status, label: status } },
    },
  } as unknown as DragEndEvent;
}

beforeEach(() => {
  workspace.useWorkspace.mockReset();
  dnd.contextProps = null;
  dnd.droppables.clear();
});

afterEach(cleanup);

describe("ProjectBoard", () => {
  it("renders every lifecycle state with an accessible drag handle", () => {
    const currentProject = project();
    workspace.useWorkspace.mockReturnValue({ data: data(), mutate: vi.fn() });

    render(
      <ProjectBoard
        projects={[currentProject]}
        progressByProject={new Map([[currentProject.id, progress]])}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByRole("region", { name: "项目状态 已取消" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "拖动项目 Launch mobile navigation" }),
    ).toBeInTheDocument();
  });

  it("moves a project optimistically and persists the target status", async () => {
    const currentProject = project();
    let resolveMutation!: (value: Project) => void;
    const mutation = new Promise<Project>((resolve) => {
      resolveMutation = resolve;
    });
    const mutate = vi.fn().mockReturnValue(mutation);
    workspace.useWorkspace.mockReturnValue({ data: data(), mutate });
    render(
      <ProjectBoard
        projects={[currentProject]}
        progressByProject={new Map([[currentProject.id, progress]])}
        onOpen={vi.fn()}
      />,
    );

    act(() => dnd.contextProps?.onDragEnd?.(drop(currentProject.id, "started")));

    expect(
      within(screen.getByRole("region", { name: "项目状态 进行中" })).getByText(
        currentProject.name,
      ),
    ).toBeInTheDocument();
    expect(mutate).toHaveBeenCalledWith(
      "project.update",
      { projectId: currentProject.id, changes: { status: "started" } },
      { successMessage: `${currentProject.name} 已移至进行中` },
    );

    resolveMutation({ ...currentProject, status: "started" });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("已移至进行中");
    });
  });
});
