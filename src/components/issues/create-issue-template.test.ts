import { describe, expect, it } from "vitest";

import type { BootstrapData, Issue, IssueTemplate } from "@/lib/domain";
import {
  applicableIssueTemplates,
  resolveIssueTemplateDefaults,
} from "./create-issue-template";

function template(
  id: string,
  teamId: string | null,
  defaults: Partial<Issue> = {},
): IssueTemplate {
  return {
    id,
    workspaceId: "workspace_1",
    teamId,
    name: id,
    titleTemplate: "",
    descriptionTemplate: "",
    defaults,
    subIssues: [],
    createdAt: "2026-07-11T00:00:00.000Z",
  };
}

const context = {
  states: [
    { id: "state_main", teamId: "team_main", name: "Todo", type: "unstarted", color: "#000", position: 1 },
    { id: "state_other", teamId: "team_other", name: "Todo", type: "unstarted", color: "#000", position: 1 },
  ],
  memberships: [
    { userId: "user_active", status: "active" },
    { userId: "user_suspended", status: "suspended" },
  ],
  projects: [{ id: "project_1" }],
  cycles: [
    { id: "cycle_main", teamId: "team_main" },
    { id: "cycle_other", teamId: "team_other" },
  ],
  labels: [{ id: "label_1" }, { id: "label_2" }],
} as Pick<BootstrapData, "states" | "memberships" | "projects" | "cycles" | "labels">;

describe("create issue template helpers", () => {
  it("returns workspace templates and templates scoped to the selected team", () => {
    expect(
      applicableIssueTemplates(
        [template("workspace", null), template("main", "team_main"), template("other", "team_other")],
        "team_main",
      ).map((candidate) => candidate.id),
    ).toEqual(["workspace", "main"]);
  });

  it("applies every supported valid default", () => {
    const defaults = resolveIssueTemplateDefaults(
      template("full", "team_main", {
        statusId: "state_main",
        priority: 2,
        assigneeId: "user_active",
        projectId: "project_1",
        cycleId: "cycle_main",
        labelIds: ["label_1", "label_1", "label_2"],
        estimate: 8,
        dueDate: "2026-08-09T12:30:00.000Z",
      }),
      "team_main",
      "state_main",
      context,
    );

    expect(defaults).toEqual({
      statusId: "state_main",
      priority: 2,
      assigneeId: "user_active",
      projectId: "project_1",
      cycleId: "cycle_main",
      labelIds: ["label_1", "label_2"],
      estimate: 8,
      dueDate: "2026-08-09",
    });
  });

  it("drops stale, cross-team, suspended, and malformed defaults", () => {
    const invalidDefaults = {
      statusId: "state_other",
      priority: 9,
      assigneeId: "user_suspended",
      projectId: "missing_project",
      cycleId: "cycle_other",
      labelIds: ["label_1", "missing_label"],
      estimate: -1,
      dueDate: "2026-02-31",
    } as unknown as Partial<Issue>;

    expect(
      resolveIssueTemplateDefaults(
        template("stale", "team_main", invalidDefaults),
        "team_main",
        "state_main",
        context,
      ),
    ).toEqual({
      statusId: "state_main",
      priority: 0,
      assigneeId: "",
      projectId: "",
      cycleId: "",
      labelIds: ["label_1"],
      estimate: null,
      dueDate: "",
    });
  });
});
