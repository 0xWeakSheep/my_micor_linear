import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BootstrapData, Issue } from "@/lib/domain";

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

import { useWorkspace, WorkspaceProvider } from "./workspace-provider";

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

function issue(statusId = "todo"): Issue {
  return {
    id: "issue_1",
    workspaceId: "workspace_1",
    teamId: "team_1",
    identifier: "ENG-1",
    number: 1,
    title: "Drag me",
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
    triageStatus: null,
    snoozedUntil: null,
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

function data(): BootstrapData {
  return {
    workspace: { id: "workspace_1", slug: "workspace", name: "Workspace" },
    issues: [issue()],
  } as unknown as BootstrapData;
}

function response<T>(body: T, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function Harness() {
  const { data: workspace, mutate, updateIssue, updatingIssueIds } = useWorkspace();
  const currentIssue = workspace.issues[0];
  return (
    <div>
      <span data-testid="status">{currentIssue.statusId}</span>
      <span data-testid="pending">{updatingIssueIds.has(currentIssue.id) ? "yes" : "no"}</span>
      <button
        type="button"
        onClick={() => void mutate("test.action", {}).then((result) => {
          document.body.dataset.mutation = result ? "success" : "failure";
        })}
      >
        Mutate
      </button>
      <button type="button" onClick={() => void updateIssue(currentIssue.id, { statusId: "progress" })}>
        Progress
      </button>
      <button type="button" onClick={() => void updateIssue(currentIssue.id, { statusId: "done" })}>
        Done
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <WorkspaceProvider initialData={data()}>
      <Harness />
    </WorkspaceProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  toast.error.mockReset();
  toast.success.mockReset();
  toast.warning.mockReset();
  document.body.dataset.mutation = "";
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WorkspaceProvider mutations", () => {
  it("keeps a successful mutation when the following bootstrap refresh fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, data: true }))
      .mockResolvedValueOnce(response({ ok: false, error: "offline" }, false))
      .mockResolvedValue(response({ ok: false, error: "offline" }, false));
    vi.stubGlobal("fetch", fetchMock);
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "Mutate" }));

    await waitFor(() => expect(document.body.dataset.mutation).toBe("success"));
    expect(toast.warning).toHaveBeenCalledWith(
      "操作已保存，但数据同步失败，将自动重试",
    );
  });

  it("rolls an optimistic issue update back when persistence fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ ok: false, error: "denied" }, false)),
    );
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "Progress" }));
    expect(screen.getByTestId("status")).toHaveTextContent("progress");
    expect(screen.getByTestId("pending")).toHaveTextContent("yes");

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("todo"));
    expect(screen.getByTestId("pending")).toHaveTextContent("no");
    expect(toast.error).toHaveBeenCalledWith("Issue 更新失败，已恢复原值");
  });

  it("serializes rapid updates and does not let an older failure roll back the latest intent", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal("fetch", fetchMock);
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "Progress" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("status")).toHaveTextContent("done");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    first.resolve(response({ ok: false, error: "stale failure" }, false));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("status")).toHaveTextContent("done");

    second.resolve(response({ ok: true, data: issue("done") }));
    await waitFor(() => expect(screen.getByTestId("pending")).toHaveTextContent("no"));
    expect(screen.getByTestId("status")).toHaveTextContent("done");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
