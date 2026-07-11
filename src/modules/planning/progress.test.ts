import { describe, expect, it } from "vitest";
import type { Cycle, Issue, WorkflowState } from "../../lib/domain";
import {
  calculateCycleProgress,
  calculateCycleVelocity,
  calculateProgress,
  calculateProjectProgress,
  getIssueEffort,
} from "./progress";

const NOW = "2026-07-11T00:00:00.000Z";

function state(
  id: string,
  type: WorkflowState["type"],
): WorkflowState {
  return {
    id,
    teamId: "team",
    name: id,
    type,
    color: "#000",
    position: 0,
  };
}

const STATES = [
  state("started", "started"),
  state("done", "completed"),
  state("canceled", "canceled"),
];

function issue(id: string, overrides: Partial<Issue> = {}): Issue {
  const number = Number(id.replace(/\D/gu, "")) || 1;
  return {
    id,
    workspaceId: "workspace",
    teamId: "team",
    identifier: `ENG-${number}`,
    number,
    title: id,
    description: "",
    statusId: "started",
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

function cycle(
  id: string,
  number: number,
  endDate: string,
  status: Cycle["status"] = "completed",
): Cycle {
  return {
    id,
    teamId: "team",
    number,
    name: `Cycle ${number}`,
    description: "",
    startDate: `${endDate.slice(0, 8)}01`,
    endDate,
    status,
    createdAt: NOW,
  };
}

describe("calculateProgress", () => {
  it("uses effort, excludes canceled and trashed work, and retains archived history", () => {
    const issues = [
      issue("done-3", { statusId: "done", estimate: 3 }),
      issue("active-5", { estimate: 5 }),
      issue("done-unestimated", { statusId: "done", estimate: null }),
      issue("canceled-8", { statusId: "canceled", estimate: 8 }),
      issue("trashed-13", { statusId: "done", estimate: 13, trashedAt: NOW }),
      issue("archived-2", { statusId: "done", estimate: 2, archivedAt: NOW }),
    ];

    expect(calculateProgress(issues, STATES)).toEqual({
      totalIssues: 4,
      completedIssues: 3,
      activeIssues: 1,
      canceledIssues: 1,
      totalEffort: 11,
      completedEffort: 6,
      remainingEffort: 5,
      issueProgress: 75,
      effortProgress: 54.55,
      progress: 54.55,
    });
  });

  it("can make issue count the primary progress metric", () => {
    const result = calculateProgress(
      [
        issue("done", { statusId: "done", estimate: 1 }),
        issue("active", { estimate: 9 }),
      ],
      STATES,
      { mode: "issues" },
    );

    expect(result.issueProgress).toBe(50);
    expect(result.effortProgress).toBe(10);
    expect(result.progress).toBe(50);
  });

  it("falls back to terminal timestamps for imported unknown statuses", () => {
    const result = calculateProgress(
      [
        issue("done", { statusId: "missing-a", completedAt: NOW }),
        issue("canceled", { statusId: "missing-b", canceledAt: NOW }),
      ],
      STATES,
    );

    expect(result.completedIssues).toBe(1);
    expect(result.canceledIssues).toBe(1);
    expect(result.progress).toBe(100);
  });

  it("uses count progress when all explicit estimates are zero", () => {
    const result = calculateProgress(
      [
        issue("done", { statusId: "done", estimate: 0 }),
        issue("active", { estimate: 0 }),
      ],
      STATES,
    );

    expect(result.totalEffort).toBe(0);
    expect(result.issueProgress).toBe(50);
    expect(result.effortProgress).toBe(50);
  });

  it("normalizes unestimated and invalid estimate values", () => {
    expect(getIssueEffort({ estimate: null })).toBe(1);
    expect(getIssueEffort({ estimate: null }, { unestimatedValue: 2 })).toBe(2);
    expect(getIssueEffort({ estimate: -1 }, { unestimatedValue: 2 })).toBe(2);
    expect(getIssueEffort({ estimate: Number.NaN })).toBe(1);
  });
});

describe("scoped progress", () => {
  const issues = [
    issue("p1-done", {
      projectId: "project-1",
      cycleId: "cycle-1",
      statusId: "done",
      estimate: 3,
    }),
    issue("p1-active", {
      projectId: "project-1",
      cycleId: "cycle-2",
      estimate: 1,
    }),
    issue("p2-done", {
      projectId: "project-2",
      cycleId: "cycle-1",
      statusId: "done",
      estimate: 5,
    }),
  ];

  it("calculates one project's progress", () => {
    const result = calculateProjectProgress("project-1", issues, STATES);
    expect(result.totalIssues).toBe(2);
    expect(result.completedIssues).toBe(1);
    expect(result.progress).toBe(75);
  });

  it("calculates one cycle's progress", () => {
    const result = calculateCycleProgress({ id: "cycle-1" }, issues, STATES);
    expect(result.totalIssues).toBe(2);
    expect(result.completedIssues).toBe(2);
    expect(result.progress).toBe(100);
  });
});

describe("calculateCycleVelocity", () => {
  const cycles = [
    cycle("c1", 1, "2026-01-31"),
    cycle("c2", 2, "2026-02-28"),
    cycle("c3", 3, "2026-03-31"),
    cycle("c4", 4, "2026-04-30"),
    cycle("c5", 5, "2026-05-31", "active"),
  ];
  const issues = [
    issue("c1-done", { cycleId: "c1", statusId: "done", estimate: 10 }),
    issue("c2-done", { cycleId: "c2", statusId: "done", estimate: 2 }),
    issue("c2-active", { cycleId: "c2", estimate: 20 }),
    issue("c3-done", { cycleId: "c3", statusId: "done", estimate: null }),
    issue("c4-done-a", { cycleId: "c4", statusId: "done", estimate: 4 }),
    issue("c4-done-b", { cycleId: "c4", statusId: "done", estimate: 2 }),
    issue("c5-done", { cycleId: "c5", statusId: "done", estimate: 50 }),
  ];

  it("uses the latest three completed cycles and returns chronological points", () => {
    const result = calculateCycleVelocity(cycles, issues, STATES);

    expect(result.cycles.map(({ cycleId }) => cycleId)).toEqual(["c2", "c3", "c4"]);
    expect(result.cycles.map(({ completedEffort }) => completedEffort)).toEqual([2, 1, 6]);
    expect(result.cycles.map(({ completedIssues }) => completedIssues)).toEqual([1, 1, 2]);
    expect(result.cyclesConsidered).toBe(3);
    expect(result.totalCompletedIssues).toBe(4);
    expect(result.totalCompletedEffort).toBe(9);
    expect(result.averageCompletedIssues).toBe(1.33);
    expect(result.averageCompletedEffort).toBe(3);
  });

  it("supports a historical cutoff and custom window", () => {
    const result = calculateCycleVelocity(cycles, issues, STATES, {
      windowSize: 2,
      before: "2026-03-31T23:59:59.000Z",
    });

    expect(result.cycles.map(({ cycleId }) => cycleId)).toEqual(["c2", "c3"]);
  });

  it("returns zeros when no completed cycles are selected", () => {
    expect(calculateCycleVelocity(cycles, issues, STATES, { windowSize: 0 })).toEqual({
      cycles: [],
      cyclesConsidered: 0,
      totalCompletedIssues: 0,
      totalCompletedEffort: 0,
      averageCompletedIssues: 0,
      averageCompletedEffort: 0,
    });
  });

  it("does not mutate cycle ordering", () => {
    const idsBefore = cycles.map(({ id }) => id);
    calculateCycleVelocity(cycles, issues, STATES);
    expect(cycles.map(({ id }) => id)).toEqual(idsBefore);
  });
});
