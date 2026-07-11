import { describe, expect, it } from "vitest";
import type { Issue } from "../../lib/domain";
import {
  findIssueParentCycle,
  getIssuePriorityLabel,
  getIssuePriorityRank,
  getIssueStatusTransitionChanges,
  hasIssueParentCycle,
  ISSUE_PRIORITY_METADATA,
  wouldCreateIssueParentCycle,
} from "./logic";

function relationIssue(
  id: string,
  parentId: string | null,
): Pick<Issue, "id" | "parentId"> {
  return { id, parentId };
}

describe("issue priority metadata", () => {
  it("maps persisted values to Linear labels", () => {
    expect(getIssuePriorityLabel(0)).toBe("No priority");
    expect(getIssuePriorityLabel(1)).toBe("Urgent");
    expect(getIssuePriorityLabel(2)).toBe("High");
    expect(getIssuePriorityLabel(3)).toBe("Medium");
    expect(getIssuePriorityLabel(4)).toBe("Low");
  });

  it("orders actionable priorities before no priority", () => {
    const ordered = ([0, 4, 2, 1, 3] as const).toSorted(
      (left, right) => getIssuePriorityRank(left) - getIssuePriorityRank(right),
    );

    expect(ordered).toEqual([1, 2, 3, 4, 0]);
    expect(ISSUE_PRIORITY_METADATA[1].rank).toBeLessThan(
      ISSUE_PRIORITY_METADATA[4].rank,
    );
  });
});

describe("issue status transitions", () => {
  it("accepts pending triage when moving into normal workflow", () => {
    expect(
      getIssueStatusTransitionChanges(
        { triageStatus: "pending" },
        { type: "triage" },
        { id: "todo", type: "unstarted" },
      ),
    ).toEqual({
      statusId: "todo",
      triageStatus: "accepted",
      snoozedUntil: null,
    });
  });

  it("declines pending triage when moving into a canceled state", () => {
    expect(
      getIssueStatusTransitionChanges(
        { triageStatus: "snoozed" },
        { type: "triage" },
        { id: "canceled", type: "canceled" },
      ),
    ).toEqual({
      statusId: "canceled",
      triageStatus: "declined",
      snoozedUntil: null,
    });
  });

  it("marks an issue pending when it enters triage", () => {
    expect(
      getIssueStatusTransitionChanges(
        { triageStatus: null },
        { type: "unstarted" },
        { id: "triage", type: "triage" },
      ),
    ).toEqual({
      statusId: "triage",
      triageStatus: "pending",
      snoozedUntil: null,
    });
  });

  it("leaves resolved triage metadata unchanged during normal moves", () => {
    expect(
      getIssueStatusTransitionChanges(
        { triageStatus: "accepted" },
        { type: "unstarted" },
        { id: "started", type: "started" },
      ),
    ).toEqual({ statusId: "started" });
  });
});

describe("issue parent cycle detection", () => {
  it("finds a cycle and returns each member once", () => {
    const issues = [
      relationIssue("a", "b"),
      relationIssue("b", "c"),
      relationIssue("c", "a"),
      relationIssue("outside", null),
    ];

    expect(findIssueParentCycle(issues)).toEqual(["a", "b", "c"]);
    expect(hasIssueParentCycle(issues)).toBe(true);
  });

  it("does not report a normal parent chain or a missing external parent", () => {
    const issues = [
      relationIssue("root", null),
      relationIssue("child", "root"),
      relationIssue("external-child", "not-loaded"),
    ];

    expect(findIssueParentCycle(issues)).toBeNull();
    expect(hasIssueParentCycle(issues)).toBe(false);
  });

  it("rejects self-parenting and assigning an ancestor below its descendant", () => {
    const issues = [
      relationIssue("root", null),
      relationIssue("child", "root"),
      relationIssue("grandchild", "child"),
    ];

    expect(wouldCreateIssueParentCycle(issues, "root", "root")).toBe(true);
    expect(wouldCreateIssueParentCycle(issues, "root", "grandchild")).toBe(true);
    expect(wouldCreateIssueParentCycle(issues, "child", "root")).toBe(false);
    expect(wouldCreateIssueParentCycle(issues, "child", null)).toBe(false);
  });

  it("rejects attachment to an already cyclic ancestry", () => {
    const issues = [
      relationIssue("a", "b"),
      relationIssue("b", "a"),
      relationIssue("new", null),
    ];

    expect(wouldCreateIssueParentCycle(issues, "new", "a")).toBe(true);
  });

  it("does not treat an unloaded proposed parent as a cycle", () => {
    expect(
      wouldCreateIssueParentCycle([relationIssue("issue", null)], "issue", "external"),
    ).toBe(false);
  });
});
