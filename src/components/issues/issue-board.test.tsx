import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";

import type { BootstrapData, Issue, WorkflowState } from "@/lib/domain";

interface MockDndContextProps {
  onDragStart?: (event: DragStartEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  onDragCancel?: () => void;
  children?: React.ReactNode;
}

const dnd = vi.hoisted(() => ({
  contextProps: null as MockDndContextProps | null,
  droppables: new Map<string, { data: Record<string, unknown>; disabled: boolean }>(),
  draggables: new Map<string, { disabled: boolean }>(),
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
    useDroppable: ({
      id,
      data,
      disabled = false,
    }: {
      id: string;
      data: Record<string, unknown>;
      disabled?: boolean;
    }) => {
      dnd.droppables.set(String(id), { data, disabled });
      return { setNodeRef: vi.fn(), isOver: false };
    },
    useDraggable: ({ id, disabled = false }: { id: string; disabled?: boolean }) => {
      dnd.draggables.set(String(id), { disabled });
      return {
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
      };
    },
  };
});

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

vi.mock("@dnd-kit/sortable", async () => {
  const React = await import("react");
  return {
    sortableKeyboardCoordinates: vi.fn(),
    verticalListSortingStrategy: vi.fn(),
    SortableContext: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useSortable: ({
      id,
      disabled,
    }: {
      id: string;
      disabled?: boolean | { draggable?: boolean; droppable?: boolean };
    }) => {
      const dragDisabled = typeof disabled === "boolean" ? disabled : Boolean(disabled?.draggable);
      dnd.draggables.set(String(id), { disabled: dragDisabled });
      return {
        attributes: {
          role: "button",
          tabIndex: 0,
          "aria-disabled": dragDisabled,
          "aria-pressed": false,
          "aria-roledescription": "sortable",
          "aria-describedby": "drag-description",
        },
        listeners: { onKeyDown: vi.fn() },
        setNodeRef: vi.fn(),
        setActivatorNodeRef: vi.fn(),
        transform: null,
        transition: undefined,
        isDragging: false,
      };
    },
  };
});

import { IssueBoard } from "./issue-board";

function state(
  id: string,
  teamId: string,
  name: string,
  type: WorkflowState["type"],
  position: number,
): WorkflowState {
  return { id, teamId, name, type, position, color: "#5e6ad2" };
}

function issue(id: string, teamId: string, statusId: string, triageStatus: Issue["triageStatus"] = null): Issue {
  return {
    id,
    workspaceId: "workspace_1",
    teamId,
    identifier: id.toUpperCase(),
    number: 1,
    title: `Issue ${id}`,
    description: "",
    statusId,
    priority: 0,
    assigneeId: null,
    creatorId: "user_1",
    projectId: null,
    milestoneId: null,
    cycleId: null,
    parentId: null,
    estimate: null,
    dueDate: null,
    sortOrder: 100,
    triageStatus,
    snoozedUntil: triageStatus === "snoozed" ? "2026-07-12T00:00:00.000Z" : null,
    completedAt: null,
    canceledAt: null,
    archivedAt: null,
    trashedAt: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    labelIds: [],
    subscriberIds: [],
  };
}

const states = [
  state("eng_triage", "engineering", "Triage", "triage", 0),
  state("eng_todo", "engineering", "Todo", "unstarted", 100),
  state("eng_progress", "engineering", "In Progress", "started", 200),
  state("eng_review", "engineering", "In Review", "started", 300),
  state("eng_done", "engineering", "Done", "completed", 400),
  state("eng_canceled", "engineering", "Canceled", "canceled", 500),
  state("design_todo", "design", "Todo", "unstarted", 100),
  state("design_progress", "design", "Designing", "started", 200),
  state("design_done", "design", "Done", "completed", 400),
  state("ops_todo", "operations", "Todo", "unstarted", 100),
] satisfies WorkflowState[];

function boardData(issues: Issue[]): BootstrapData {
  return {
    issues,
    states,
    memberships: [],
    labels: [],
    comments: [],
  } as unknown as BootstrapData;
}

function dragStart(issueId: string): DragStartEvent {
  return { active: { id: issueId } } as unknown as DragStartEvent;
}

function dragEnd(
  issueId: string,
  target: {
    statusId: string | null;
    statusType: WorkflowState["type"] | null;
    label: string;
    columnId?: string;
    issueId?: string;
  } | null,
): DragEndEvent {
  return {
    active: {
      id: issueId,
      rect: { current: { translated: { top: 0, height: 20 } } },
    },
    over: target
      ? {
          id: `column:${target.statusId ?? target.statusType}`,
          data: { current: target },
          rect: { top: 100, height: 40 },
        }
      : null,
  } as unknown as DragEndEvent;
}

beforeEach(() => {
  workspace.useWorkspace.mockReset();
  dnd.contextProps = null;
  dnd.droppables.clear();
  dnd.draggables.clear();
});

afterEach(cleanup);

describe("IssueBoard drag status", () => {
  it("renders every workflow state and exposes a unique drag handle", () => {
    const currentIssue = issue("eng-1", "engineering", "eng_todo");
    const setCreateIssueOpen = vi.fn();
    workspace.useWorkspace.mockReturnValue({
      data: boardData([currentIssue]),
      preferences: { sortBy: "manual" },
      updateIssue: vi.fn(),
      updatingIssueIds: new Set(),
      setSelectedIssueId: vi.fn(),
      setCreateIssueOpen,
    });

    render(<IssueBoard issues={[currentIssue]} scopeTeamIds={["engineering"]} />);

    expect(screen.getByRole("region", { name: "状态列 Canceled" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拖动 ENG-1" })).toBeInTheDocument();
    screen.getByRole("button", { name: "在 Todo 中新建" }).click();
    expect(setCreateIssueOpen).toHaveBeenCalledWith(true, {
      teamId: "engineering",
      statusId: "eng_todo",
    });
  });

  it("applies triage acceptance fields when a card moves to Todo", async () => {
    const currentIssue = issue("eng-1", "engineering", "eng_triage", "pending");
    const updateIssue = vi.fn().mockResolvedValue(true);
    workspace.useWorkspace.mockReturnValue({
      data: boardData([currentIssue]),
      preferences: { sortBy: "manual" },
      updateIssue,
      updatingIssueIds: new Set(),
      setSelectedIssueId: vi.fn(),
      setCreateIssueOpen: vi.fn(),
    });
    render(<IssueBoard issues={[currentIssue]} scopeTeamIds={["engineering"]} />);

    act(() => {
      dnd.contextProps?.onDragEnd?.(
        dragEnd("eng-1", { statusId: "eng_todo", statusType: null, label: "Todo" }),
      );
    });

    await waitFor(() => {
      expect(updateIssue).toHaveBeenCalledWith("eng-1", {
        statusId: "eng_todo",
        triageStatus: "accepted",
        snoozedUntil: null,
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent("ENG-1 已移至 Todo");
  });

  it("does not collapse a review state when dropped inside the same aggregate type", async () => {
    const reviewIssue = issue("eng-1", "engineering", "eng_review");
    const designIssue = issue("des-1", "design", "design_progress");
    const updateIssue = vi.fn().mockResolvedValue(true);
    workspace.useWorkspace.mockReturnValue({
      data: boardData([reviewIssue, designIssue]),
      preferences: { sortBy: "manual" },
      updateIssue,
      updatingIssueIds: new Set(),
      setSelectedIssueId: vi.fn(),
      setCreateIssueOpen: vi.fn(),
    });
    render(<IssueBoard issues={[reviewIssue, designIssue]} />);

    act(() => {
      dnd.contextProps?.onDragEnd?.(
        dragEnd("eng-1", { statusId: null, statusType: "started", label: "In Progress" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("状态和顺序未改变");
    });
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("disables aggregate columns that the dragged issue team cannot use", () => {
    const engineeringIssue = issue("eng-1", "engineering", "eng_triage");
    const operationsIssue = issue("ops-1", "operations", "ops_todo");
    workspace.useWorkspace.mockReturnValue({
      data: boardData([engineeringIssue, operationsIssue]),
      preferences: { sortBy: "manual" },
      updateIssue: vi.fn(),
      updatingIssueIds: new Set(),
      setSelectedIssueId: vi.fn(),
      setCreateIssueOpen: vi.fn(),
    });
    render(<IssueBoard issues={[engineeringIssue, operationsIssue]} />);

    act(() => dnd.contextProps?.onDragStart?.(dragStart("ops-1")));

    expect(dnd.droppables.get("column:type:triage")?.disabled).toBe(true);
    expect(screen.getByRole("region", { name: "状态列 Triage" })).toHaveAttribute(
      "data-drop-disabled",
      "true",
    );
  });

  it("persists a manual order when a card moves before another card", async () => {
    const first = { ...issue("eng-1", "engineering", "eng_todo"), sortOrder: 100 };
    const second = { ...issue("eng-2", "engineering", "eng_todo"), sortOrder: 200 };
    const updateIssue = vi.fn().mockResolvedValue(true);
    workspace.useWorkspace.mockReturnValue({
      data: boardData([first, second]),
      preferences: { sortBy: "manual" },
      updateIssue,
      updatingIssueIds: new Set(),
      setSelectedIssueId: vi.fn(),
      setCreateIssueOpen: vi.fn(),
    });
    render(<IssueBoard issues={[first, second]} scopeTeamIds={["engineering"]} />);

    act(() => {
      dnd.contextProps?.onDragEnd?.(
        dragEnd("eng-2", {
          statusId: "eng_todo",
          statusType: null,
          label: "Todo",
          columnId: "eng_todo",
          issueId: "eng-1",
        }),
      );
    });

    await waitFor(() => {
      expect(updateIssue).toHaveBeenCalledWith("eng-2", {
        statusId: "eng_todo",
        sortOrder: -924,
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent("顺序已更新");
  });

  it("disables dragging while an issue update is pending", () => {
    const currentIssue = issue("eng-1", "engineering", "eng_todo");
    workspace.useWorkspace.mockReturnValue({
      data: boardData([currentIssue]),
      preferences: { sortBy: "manual" },
      updateIssue: vi.fn(),
      updatingIssueIds: new Set([currentIssue.id]),
      setSelectedIssueId: vi.fn(),
      setCreateIssueOpen: vi.fn(),
    });
    render(<IssueBoard issues={[currentIssue]} scopeTeamIds={["engineering"]} />);

    expect(screen.getByRole("button", { name: "正在保存 ENG-1" })).toBeDisabled();
    expect(dnd.draggables.get("eng-1")?.disabled).toBe(true);
  });
});
