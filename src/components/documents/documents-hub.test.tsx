import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BootstrapData, Document } from "@/lib/domain";

const workspace = vi.hoisted(() => ({
  useWorkspace: vi.fn(),
}));

vi.mock("@/components/workspace/workspace-provider", () => ({
  useWorkspace: workspace.useWorkspace,
}));

import { DocumentsHub } from "./documents-hub";

const launchDocument: Document = {
  id: "doc_launch",
  workspaceId: "ws_micro_linear",
  projectId: "project_launch",
  title: "Launch brief",
  content: "# Outcome\n\nShip a calm, fast workspace.",
  creatorId: "usr_demo",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
};

const runbookDocument: Document = {
  id: "doc_runbook",
  workspaceId: "ws_micro_linear",
  projectId: null,
  title: "Restore runbook",
  content: "# Restore\n\nStop writers before copying SQLite.",
  creatorId: "usr_other",
  createdAt: "2026-07-02T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
};

function bootstrap(role: "admin" | "member" | "guest" = "member"): BootstrapData {
  return {
    currentUser: {
      id: "usr_demo",
      name: "Alex Chen",
      email: "alex@micro-linear.test",
      avatarUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    currentMembership: {
      id: "wmem_demo",
      workspaceId: "ws_micro_linear",
      userId: "usr_demo",
      role,
      status: "active",
      joinedAt: "2026-01-01T00:00:00.000Z",
      user: {
        id: "usr_demo",
        name: "Alex Chen",
        email: "alex@micro-linear.test",
        avatarUrl: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
    workspace: {
      id: "ws_micro_linear",
      name: "Micro Linear",
      slug: "micro-linear",
      icon: "O",
      timezone: "UTC",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    memberships: [
      {
        id: "wmem_demo",
        workspaceId: "ws_micro_linear",
        userId: "usr_demo",
        role,
        status: "active",
        joinedAt: "2026-01-01T00:00:00.000Z",
        user: {
          id: "usr_demo",
          name: "Alex Chen",
          email: "alex@micro-linear.test",
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
      {
        id: "wmem_other",
        workspaceId: "ws_micro_linear",
        userId: "usr_other",
        role: "member",
        status: "active",
        joinedAt: "2026-01-01T00:00:00.000Z",
        user: {
          id: "usr_other",
          name: "Maya Patel",
          email: "maya@micro-linear.test",
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      },
    ],
    projects: [
      {
        id: "project_launch",
        workspaceId: "ws_micro_linear",
        teamId: null,
        name: "Public launch",
        slug: "public-launch",
        summary: "",
        description: "",
        status: "started",
        priority: 2,
        leadId: null,
        color: "#5E6AD2",
        icon: "P",
        startDate: null,
        targetDate: null,
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        teamIds: [],
        memberIds: [],
      },
    ],
    documents: [launchDocument, runbookDocument],
    teams: [],
    teamMembers: [],
    states: [],
    labels: [],
    issues: [],
    relations: [],
    comments: [],
    reactions: [],
    attachments: [],
    activities: [],
    milestones: [],
    projectUpdates: [],
    projectDependencies: [],
    cycles: [],
    initiatives: [],
    views: [],
    favorites: [],
    notifications: [],
    notificationPreferences: {
      assigned: true,
      mentioned: true,
      subscribed: true,
      projectUpdates: true,
    },
    templates: [],
    recurringIssues: [],
    apiKeys: [],
    webhooks: [],
  };
}

beforeEach(() => {
  workspace.useWorkspace.mockReset();
});

describe("DocumentsHub", () => {
  it("lists documents and filters across Markdown content", () => {
    workspace.useWorkspace.mockReturnValue({ data: bootstrap(), mutate: vi.fn() });
    render(<DocumentsHub documentId={null} />);

    expect(screen.getByText("Launch brief")).toBeInTheDocument();
    expect(screen.getByText("Restore runbook")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "搜索文档" }), {
      target: { value: "SQLite" },
    });

    expect(screen.queryByText("Launch brief")).not.toBeInTheDocument();
    expect(screen.getByText("Restore runbook")).toBeInTheDocument();
  });

  it("saves title, Markdown and project changes through document.update", async () => {
    const mutate = vi.fn().mockResolvedValue({
      ...launchDocument,
      title: "Updated launch brief",
    });
    workspace.useWorkspace.mockReturnValue({ data: bootstrap(), mutate });
    render(<DocumentsHub documentId={launchDocument.id} />);

    fireEvent.change(screen.getByRole("textbox", { name: "文档标题" }), {
      target: { value: "Updated launch brief" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown 内容" }), {
      target: { value: "# Updated\n\nA new plan." },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        "document.update",
        {
          documentId: launchDocument.id,
          changes: {
            title: "Updated launch brief",
            content: "# Updated\n\nA new plan.",
            projectId: "project_launch",
          },
        },
        { quiet: true },
      ),
    );
    expect(await screen.findByText("已保存")).toBeInTheDocument();
  });

  it("lets workspace members edit another member's document without deleting it", () => {
    workspace.useWorkspace.mockReturnValue({ data: bootstrap("member"), mutate: vi.fn() });
    render(<DocumentsHub documentId={runbookDocument.id} />);

    expect(screen.getByRole("textbox", { name: "文档标题" })).not.toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除文档" })).not.toBeInTheDocument();
  });

  it("creates a document with an optional project and opens its route", async () => {
    const created = {
      ...launchDocument,
      id: "doc_created",
      title: "Release notes",
    };
    const mutate = vi.fn().mockResolvedValue(created);
    const onNavigate = vi.fn();
    workspace.useWorkspace.mockReturnValue({ data: bootstrap(), mutate });
    render(<DocumentsHub documentId={null} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), {
      target: { value: "Release notes" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "关联项目" }), {
      target: { value: "project_launch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建文档" }));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        "document.create",
        {
          title: "Release notes",
          content: "",
          projectId: "project_launch",
        },
        { successMessage: "文档已创建" },
      ),
    );
    expect(onNavigate).toHaveBeenCalledWith("doc_created");
  });

  it("confirms deletion and returns to the document list", async () => {
    const mutate = vi.fn().mockResolvedValue(true);
    const onNavigate = vi.fn();
    workspace.useWorkspace.mockReturnValue({ data: bootstrap(), mutate });
    render(<DocumentsHub documentId={launchDocument.id} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "删除文档" }));
    expect(screen.getByRole("heading", { name: "删除文档？" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "删除文档" }).at(-1)!);

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        "document.delete",
        { documentId: launchDocument.id },
        { successMessage: "文档已删除" },
      ),
    );
    expect(onNavigate).toHaveBeenCalledWith(null);
  });
});
