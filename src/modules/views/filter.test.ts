import { describe, expect, it } from "vitest";
import type { Comment, Issue } from "../../lib/domain";
import {
  filterIssues,
  groupIssues,
  matchesIssueSearch,
  searchIssues,
  sortIssues,
} from "./filter";

const NOW = "2026-07-11T00:00:00.000Z";

function issue(id: string, overrides: Partial<Issue> = {}): Issue {
  const number = Number(id.replace(/\D/gu, "")) || 1;
  return {
    id,
    workspaceId: "workspace",
    teamId: "team-a",
    identifier: `ENG-${number}`,
    number,
    title: `Issue ${id}`,
    description: "",
    statusId: "todo",
    priority: 0,
    assigneeId: null,
    creatorId: "creator",
    projectId: null,
    milestoneId: null,
    cycleId: null,
    parentId: null,
    estimate: null,
    dueDate: null,
    sortOrder: number,
    triageStatus: null,
    snoozedUntil: null,
    completedAt: null,
    canceledAt: null,
    archivedAt: null,
    trashedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    labelIds: [],
    subscriberIds: [],
    ...overrides,
  };
}

function comment(issueId: string, body: string): Pick<Comment, "issueId" | "body"> {
  return { issueId, body };
}

describe("filterIssues", () => {
  const issues = [
    issue("i1", {
      teamId: "team-a",
      statusId: "todo",
      priority: 1,
      assigneeId: "user-a",
      projectId: "project-a",
      labelIds: ["bug"],
    }),
    issue("i2", {
      teamId: "team-a",
      statusId: "done",
      priority: 2,
      assigneeId: "user-b",
      projectId: "project-b",
      labelIds: ["feature"],
    }),
    issue("i3", {
      teamId: "team-b",
      statusId: "todo",
      priority: 3,
      archivedAt: NOW,
    }),
    issue("i4", {
      teamId: "team-c",
      statusId: "todo",
      trashedAt: NOW,
    }),
  ];

  it("uses OR within a field and AND across fields by default", () => {
    const result = filterIssues(issues, {
      teamIds: ["team-a", "team-b"],
      statusIds: ["todo"],
      priorities: [1, 2],
    });

    expect(result.map(({ id }) => id)).toEqual(["i1"]);
  });

  it("supports OR across active filter fields", () => {
    const result = filterIssues(issues, {
      teamIds: ["team-b"],
      priorities: [2],
      operator: "or",
      includeArchived: true,
    });

    expect(result.map(({ id }) => id)).toEqual(["i2", "i3"]);
  });

  it("excludes archived issues by default and always excludes trashed issues", () => {
    expect(filterIssues(issues, {}).map(({ id }) => id)).toEqual(["i1", "i2"]);
    expect(
      filterIssues(issues, { includeArchived: true }).map(({ id }) => id),
    ).toEqual(["i1", "i2", "i3"]);
  });

  it("treats empty filter arrays as inactive", () => {
    expect(
      filterIssues(issues, { teamIds: [], statusIds: [] }).map(({ id }) => id),
    ).toEqual(["i1", "i2"]);
  });

  it("matches search text in comments supplied through context", () => {
    const result = filterIssues(
      issues,
      { search: "Safari checkout" },
      { comments: [comment("i2", "Checkout fails only in Safari")] },
    );

    expect(result.map(({ id }) => id)).toEqual(["i2"]);
  });
});

describe("issue search", () => {
  const issues = [
    issue("i12", {
      identifier: "ENG-12",
      title: "Fix login redirect",
      description: "OAuth callback loses the target path",
    }),
    issue("i13", {
      identifier: "ENG-13",
      title: "Payment gateway",
      description: "Retry declined cards",
    }),
  ];

  it("matches case-insensitively across identifiers, titles and descriptions", () => {
    expect(matchesIssueSearch(issues[0], "LOGIN oauth")).toBe(true);
    expect(searchIssues(issues, "eng12").map(({ id }) => id)).toEqual(["i12"]);
  });

  it("requires every query token but permits tokens from different fields", () => {
    expect(matchesIssueSearch(issues[0], "redirect callback")).toBe(true);
    expect(matchesIssueSearch(issues[0], "redirect payment")).toBe(false);
  });

  it("searches supplied comment bodies", () => {
    const comments = [comment("i13", "Reproduced in Safari checkout")];
    expect(searchIssues(issues, "safari checkout", comments).map(({ id }) => id)).toEqual([
      "i13",
    ]);
  });

  it("treats an empty query as matching all issues", () => {
    expect(searchIssues(issues, "   ")).toEqual(issues);
  });
});

describe("sortIssues", () => {
  it("orders priorities Urgent to Low with No priority last", () => {
    const issues = [
      issue("none", { priority: 0 }),
      issue("medium", { priority: 3 }),
      issue("urgent", { priority: 1 }),
      issue("high", { priority: 2 }),
      issue("low", { priority: 4 }),
    ];

    expect(
      sortIssues(issues, { field: "priority" }).map(({ id }) => id),
    ).toEqual(["urgent", "high", "medium", "low", "none"]);
    expect(
      sortIssues(issues, { field: "priority", direction: "desc" }).map(
        ({ id }) => id,
      ),
    ).toEqual(["low", "medium", "high", "urgent", "none"]);
  });

  it("keeps missing dates last in both directions and is stable", () => {
    const issues = [
      issue("no-date-a", { dueDate: null }),
      issue("later", { dueDate: "2026-08-01" }),
      issue("earlier", { dueDate: "2026-07-20" }),
      issue("no-date-b", { dueDate: "not-a-date" }),
    ];

    expect(
      sortIssues(issues, { field: "dueDate", direction: "desc" }).map(
        ({ id }) => id,
      ),
    ).toEqual(["later", "earlier", "no-date-a", "no-date-b"]);
  });

  it("does not mutate input and preserves input order for equal values", () => {
    const issues = [
      issue("first", { priority: 2 }),
      issue("second", { priority: 2 }),
    ];
    const original = [...issues];
    const sorted = sortIssues(issues, { field: "priority" });

    expect(sorted.map(({ id }) => id)).toEqual(["first", "second"]);
    expect(issues).toEqual(original);
    expect(sorted).not.toBe(issues);
  });
});

describe("groupIssues", () => {
  it("places a multi-label issue into every label group and preserves an empty group", () => {
    const issues = [
      issue("a", { labelIds: ["bug", "ui"] }),
      issue("b", { labelIds: ["ui"] }),
      issue("c", { labelIds: [] }),
    ];
    const groups = groupIssues(issues, "label");

    expect(groups.map(({ value }) => value)).toEqual(["bug", "ui", null]);
    expect(groups[0].issues.map(({ id }) => id)).toEqual(["a"]);
    expect(groups[1].issues.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(groups[2].issues.map(({ id }) => id)).toEqual(["c"]);
  });

  it("uses canonical priority group order", () => {
    const groups = groupIssues(
      [
        issue("none", { priority: 0 }),
        issue("low", { priority: 4 }),
        issue("urgent", { priority: 1 }),
      ],
      "priority",
    );

    expect(groups.map(({ value }) => value)).toEqual([1, 4, 0]);
  });
});
