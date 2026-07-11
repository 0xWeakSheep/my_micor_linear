import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BootstrapData, Project } from "@/lib/domain";

const workspace = vi.hoisted(() => ({ useWorkspace: vi.fn() }));

vi.mock("@/components/workspace/workspace-provider", () => ({
  useWorkspace: workspace.useWorkspace,
}));

import { ProjectDetail } from "./project-detail";
import { ProjectsHub } from "./projects-hub";

const activeProject: Project = {
  id: "project_main",
  workspaceId: "workspace_1",
  teamId: "team_main",
  name: "Original project",
  slug: "original-project",
  summary: "Original summary",
  description: "Original description",
  status: "planned",
  priority: 0,
  leadId: "user_actor",
  color: "#5e6ad2",
  icon: "P",
  startDate: null,
  targetDate: null,
  archivedAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
  teamIds: ["team_main"],
  memberIds: ["user_actor"],
};

const archivedProject: Project = {
  ...activeProject,
  id: "project_archived",
  name: "Archived project",
  slug: "archived-project",
  archivedAt: "2026-07-12T00:00:00.000Z",
};

const relatedProject: Project = {
  ...activeProject,
  id: "project_related",
  name: "Related project",
  slug: "related-project",
};

const candidateProject: Project = {
  ...activeProject,
  id: "project_candidate",
  name: "Candidate project",
  slug: "candidate-project",
};

function data(): BootstrapData {
  return {
    workspace: {
      id: "workspace_1",
      name: "Workspace",
      slug: "workspace",
      icon: "W",
      timezone: "UTC",
      createdAt: "2026-07-01T00:00:00.000Z",
    },
    projects: [activeProject, relatedProject, candidateProject],
    projectUpdates: [],
    projectDependencies: [{
      id: "dependency_existing",
      projectId: activeProject.id,
      dependsOnProjectId: relatedProject.id,
      createdAt: "2026-07-05T00:00:00.000Z",
    }],
    milestones: [{
      id: "milestone_main",
      projectId: activeProject.id,
      name: "Public beta",
      description: "Ship to pilot users",
      targetDate: "2026-08-20",
      position: 1_024,
      createdAt: "2026-07-05T00:00:00.000Z",
    }],
    issues: [],
    states: [],
    memberships: [
      {
        id: "membership_actor",
        workspaceId: "workspace_1",
        userId: "user_actor",
        role: "member",
        status: "active",
        joinedAt: "2026-07-01T00:00:00.000Z",
        user: {
          id: "user_actor",
          name: "Actor User",
          email: "actor@example.com",
          avatarUrl: null,
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      },
      {
        id: "membership_lead",
        workspaceId: "workspace_1",
        userId: "user_lead",
        role: "member",
        status: "active",
        joinedAt: "2026-07-01T00:00:00.000Z",
        user: {
          id: "user_lead",
          name: "Lead User",
          email: "lead@example.com",
          avatarUrl: null,
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      },
    ],
    teams: [
      {
        id: "team_main",
        workspaceId: "workspace_1",
        name: "Main",
        key: "MAIN",
        description: "",
        color: "#111",
        icon: "M",
        isPrivate: false,
        triageEnabled: false,
        createdAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "team_other",
        workspaceId: "workspace_1",
        name: "Other",
        key: "OTHER",
        description: "",
        color: "#222",
        icon: "O",
        isPrivate: false,
        triageEnabled: false,
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    ],
  } as unknown as BootstrapData;
}

beforeEach(() => {
  workspace.useWorkspace.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("project maintenance UI", () => {
  it("submits all editable project fields through project.update", async () => {
    const mutate = vi.fn().mockResolvedValue(activeProject);
    workspace.useWorkspace.mockReturnValue({
      data: data(),
      mutate,
      setSelectedIssueId: vi.fn(),
    });
    render(<ProjectDetail projectId="project_main" />);

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Updated project" } });
    fireEvent.change(screen.getByLabelText("简介"), { target: { value: "Updated summary" } });
    fireEvent.change(screen.getByLabelText("说明"), { target: { value: "Updated description" } });
    fireEvent.change(screen.getByLabelText("Lead"), { target: { value: "user_lead" } });
    fireEvent.change(screen.getByLabelText("优先级"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("目标日期"), { target: { value: "2026-09-15" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Other" }));
    fireEvent.click(screen.getByRole("button", { name: "保存项目" }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        "project.update",
        {
          projectId: "project_main",
          changes: {
            name: "Updated project",
            summary: "Updated summary",
            description: "Updated description",
            leadId: "user_lead",
            priority: 2,
            startDate: "2026-08-01",
            targetDate: "2026-09-15",
            teamIds: ["team_main", "team_other"],
          },
        },
        { successMessage: "项目信息已更新" },
      );
    });
  });

  it("archives from detail and restores from the archived projects entry", async () => {
    const mutate = vi.fn().mockResolvedValue(activeProject);
    const onNavigate = vi.fn();
    workspace.useWorkspace.mockReturnValue({
      data: data(),
      mutate,
      setSelectedIssueId: vi.fn(),
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    const detail = render(<ProjectDetail projectId="project_main" onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "归档" }));
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        "project.archive",
        { projectId: "project_main" },
        { successMessage: "项目已归档" },
      );
    });
    expect(onNavigate).toHaveBeenCalledWith({ section: "projects", details: null });
    detail.unmount();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      data: [archivedProject],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    render(<ProjectsHub />);
    fireEvent.click(screen.getByRole("button", { name: "归档项目" }));
    expect(await screen.findByText("Archived project")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "恢复" }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        "project.restore",
        { projectId: "project_archived" },
        { successMessage: "Archived project 已恢复" },
      );
    });
    expect(screen.queryByText("Archived project")).not.toBeInTheDocument();
    expect(screen.getByText("还没有归档项目")).toBeInTheDocument();
  });

  it("updates and deletes milestones and maintains project dependencies", async () => {
    const mutate = vi.fn().mockResolvedValue({ id: "result" });
    workspace.useWorkspace.mockReturnValue({
      data: data(),
      mutate,
      setSelectedIssueId: vi.fn(),
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<ProjectDetail projectId="project_main" />);

    fireEvent.click(screen.getByRole("button", { name: "编辑里程碑 Public beta" }));
    fireEvent.change(screen.getByLabelText("编辑里程碑名称"), {
      target: { value: "General availability" },
    });
    fireEvent.change(screen.getByLabelText("编辑里程碑说明"), {
      target: { value: "Launch broadly" },
    });
    fireEvent.change(screen.getByLabelText("编辑里程碑目标日期"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        "milestone.update",
        {
          milestoneId: "milestone_main",
          changes: {
            name: "General availability",
            description: "Launch broadly",
            targetDate: "2026-09-01",
          },
        },
        { successMessage: "里程碑已更新" },
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "删除里程碑 Public beta" }));
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        "milestone.delete",
        { milestoneId: "milestone_main" },
        { successMessage: "里程碑已删除" },
      );
    });

    fireEvent.change(screen.getByLabelText("选择依赖项目"), {
      target: { value: "project_candidate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加依赖" }));
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        "projectDependency.create",
        { projectId: "project_main", dependsOnProjectId: "project_candidate" },
        { successMessage: "项目依赖已添加" },
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "移除项目依赖 Related project" }));
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        "projectDependency.delete",
        { dependencyId: "dependency_existing" },
        { successMessage: "项目依赖已移除" },
      );
    });
  });
});
