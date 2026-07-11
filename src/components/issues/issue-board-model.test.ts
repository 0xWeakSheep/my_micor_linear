import { describe, expect, it } from "vitest";

import type { Issue, WorkflowState } from "@/lib/domain";
import {
  buildIssueBoardColumns,
  resolveIssueBoardStatus,
} from "./issue-board-model";

function state(
  id: string,
  teamId: string,
  name: string,
  type: WorkflowState["type"],
  position: number,
): WorkflowState {
  return { id, teamId, name, type, position, color: "#5e6ad2" };
}

function issue(
  id: string,
  teamId: string,
  statusId: string,
): Issue {
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
    sortOrder: 0,
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

const states = [
  state("eng_todo", "engineering", "Todo", "unstarted", 200),
  state("eng_progress", "engineering", "In Progress", "started", 300),
  state("eng_review", "engineering", "In Review", "started", 400),
  state("eng_done", "engineering", "Done", "completed", 500),
  state("eng_canceled", "engineering", "Canceled", "canceled", 600),
  state("design_todo", "design", "Todo", "unstarted", 200),
  state("design_progress", "design", "Designing", "started", 300),
  state("design_done", "design", "Done", "completed", 500),
] satisfies WorkflowState[];

describe("issue board model", () => {
  it("keeps every single-team workflow state available as a drop target", () => {
    const columns = buildIssueBoardColumns(
      [issue("eng-1", "engineering", "eng_progress")],
      states,
    );

    expect(columns.map((column) => column.id)).toEqual([
      "eng_todo",
      "eng_progress",
      "eng_review",
      "eng_done",
      "eng_canceled",
    ]);
    expect(columns[0]).toMatchObject({
      statusId: "eng_todo",
      statusType: null,
      stateIds: ["eng_todo"],
    });
  });

  it("groups multiple teams by workflow type without losing team-specific states", () => {
    const columns = buildIssueBoardColumns(
      [
        issue("eng-1", "engineering", "eng_progress"),
        issue("des-1", "design", "design_progress"),
      ],
      states,
    );

    expect(columns.map((column) => column.id)).toEqual([
      "type:unstarted",
      "type:started",
      "type:completed",
      "type:canceled",
    ]);
    expect(columns.find((column) => column.id === "type:started")).toMatchObject({
      label: "In Progress",
      statusId: null,
      statusType: "started",
      stateIds: ["eng_progress", "design_progress", "eng_review"],
    });
  });

  it("resolves an aggregate column to the first matching state in the issue team", () => {
    const nextStatusId = resolveIssueBoardStatus(
      issue("eng-1", "engineering", "eng_todo"),
      { statusType: "started" },
      states,
    );

    expect(nextStatusId).toBe("eng_progress");
  });

  it("keeps the current state when dropping within the same aggregate type", () => {
    const nextStatusId = resolveIssueBoardStatus(
      issue("eng-1", "engineering", "eng_review"),
      { statusType: "started" },
      states,
    );

    expect(nextStatusId).toBe("eng_review");
  });

  it("rejects explicit states from a different team", () => {
    const nextStatusId = resolveIssueBoardStatus(
      issue("eng-1", "engineering", "eng_todo"),
      { statusId: "design_done" },
      states,
    );

    expect(nextStatusId).toBeNull();
  });
});
