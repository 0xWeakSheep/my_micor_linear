import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BootstrapData, Issue } from "@/lib/domain";

const workspace = vi.hoisted(() => ({
  useWorkspace: vi.fn(),
}));

vi.mock("@/components/workspace/workspace-provider", () => ({
  useWorkspace: workspace.useWorkspace,
}));

import { CreateIssueDialog } from "./create-issue-dialog";

function dialogData(): BootstrapData {
  return {
    teams: [
      {
        id: "team_main",
        workspaceId: "workspace_1",
        name: "Engineering",
        key: "ENG",
        description: "",
        color: "#5e6ad2",
        icon: "E",
        isPrivate: false,
        createdAt: "2026-07-11T00:00:00.000Z",
      },
    ],
    states: [
      {
        id: "state_todo",
        teamId: "team_main",
        name: "Todo",
        type: "unstarted",
        color: "#888",
        position: 1,
      },
      {
        id: "state_triage",
        teamId: "team_main",
        name: "Triage",
        type: "triage",
        color: "#777",
        position: 0,
      },
    ],
    memberships: [
      {
        id: "membership_owner",
        workspaceId: "workspace_1",
        userId: "user_owner",
        role: "member",
        status: "active",
        joinedAt: "2026-07-11T00:00:00.000Z",
        user: {
          id: "user_owner",
          name: "Owner User",
          email: "owner@example.com",
          avatarUrl: null,
          createdAt: "2026-07-11T00:00:00.000Z",
        },
      },
    ],
    projects: [
      {
        id: "project_release",
        workspaceId: "workspace_1",
        name: "Release",
      },
    ],
    milestones: [],
    cycles: [
      {
        id: "cycle_12",
        teamId: "team_main",
        number: 12,
        name: "Cycle 12",
      },
    ],
    labels: [
      {
        id: "label_release",
        workspaceId: "workspace_1",
        name: "Release",
        color: "#55a",
        description: "",
        groupName: null,
      },
    ],
    templates: [
      {
        id: "template_release",
        workspaceId: "workspace_1",
        teamId: "team_main",
        name: "Release checklist",
        titleTemplate: "Release 1.0",
        descriptionTemplate: "Coordinate the release.",
        defaults: {
          statusId: "state_triage",
          priority: 2,
          assigneeId: "user_owner",
          projectId: "project_release",
          cycleId: "cycle_12",
          labelIds: ["label_release"],
          estimate: 8,
          dueDate: "2026-08-01",
        },
        subIssues: [
          { title: "Run regression", description: "" },
          { title: "Publish notes", description: "Write the changelog" },
        ],
        createdAt: "2026-07-11T00:00:00.000Z",
      },
    ],
  } as unknown as BootstrapData;
}

const createdIssue = { id: "issue_created" } as Issue;

beforeEach(() => {
  workspace.useWorkspace.mockReset();
});

afterEach(() => cleanup());

describe("CreateIssueDialog templates", () => {
  it("applies the selected template and submits defaults plus sub-issues", async () => {
    const mutate = vi.fn().mockResolvedValue(createdIssue);
    const setCreateIssueOpen = vi.fn();
    const setSelectedIssueId = vi.fn();
    workspace.useWorkspace.mockReturnValue({
      data: dialogData(),
      createIssueOpen: true,
      setCreateIssueOpen,
      setSelectedIssueId,
      mutate,
    });
    render(<CreateIssueDialog />);

    fireEvent.change(screen.getByRole("combobox", { name: "模板" }), {
      target: { value: "template_release" },
    });

    expect(screen.getByPlaceholderText("Issue 标题")).toHaveValue("Release 1.0");
    expect(screen.getByPlaceholderText("添加描述… 支持 Markdown")).toHaveValue(
      "Coordinate the release.",
    );
    expect(screen.getByRole("combobox", { name: "状态" })).toHaveValue("state_triage");
    expect(screen.getByRole("combobox", { name: "优先级" })).toHaveValue("2");
    expect(screen.getByRole("combobox", { name: "负责人" })).toHaveValue("user_owner");
    expect(screen.getByRole("combobox", { name: "项目" })).toHaveValue("project_release");
    expect(screen.getByRole("combobox", { name: "周期" })).toHaveValue("cycle_12");
    expect(screen.getByRole("combobox", { name: "估算" })).toHaveValue("8");
    expect(screen.getByLabelText("截止日期")).toHaveValue("2026-08-01");
    expect(screen.getByRole("button", { name: "移除标签 Release" })).toBeInTheDocument();
    expect(screen.getByText("将同时创建 2 个子 Issue")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "创建 Issue" }));
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        "issue.create",
        {
          teamId: "team_main",
          statusId: "state_triage",
          title: "Release 1.0",
          description: "Coordinate the release.",
          priority: 2,
          assigneeId: "user_owner",
          projectId: "project_release",
          cycleId: "cycle_12",
          labelIds: ["label_release"],
          estimate: 8,
          dueDate: "2026-08-01",
          subIssues: dialogData().templates[0]?.subIssues,
        },
        { successMessage: "Issue 及 2 个子 Issue 已创建" },
      );
    });
    expect(setCreateIssueOpen).toHaveBeenCalledWith(false);
    expect(setSelectedIssueId).toHaveBeenCalledWith("issue_created");
  });

  it("keeps manual creation free of template sub-issues", async () => {
    const mutate = vi.fn().mockResolvedValue(createdIssue);
    workspace.useWorkspace.mockReturnValue({
      data: dialogData(),
      createIssueOpen: true,
      setCreateIssueOpen: vi.fn(),
      setSelectedIssueId: vi.fn(),
      mutate,
    });
    render(<CreateIssueDialog />);

    fireEvent.change(screen.getByPlaceholderText("Issue 标题"), {
      target: { value: "Manual issue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建 Issue" }));

    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const payload = mutate.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload.title).toBe("Manual issue");
    expect(payload).not.toHaveProperty("subIssues");
  });
});
