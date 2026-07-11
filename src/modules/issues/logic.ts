import type { Id, Issue } from "../../lib/domain";

export type IssuePriority = Issue["priority"];

export interface IssuePriorityMetadata {
  label: "No priority" | "Urgent" | "High" | "Medium" | "Low";
  /** Lower ranks are shown first when ordering by priority. */
  rank: number;
}

/**
 * Linear's persisted priority values are not display ranks: zero means that no
 * priority has been selected, while one through four run from urgent to low.
 */
export const ISSUE_PRIORITY_METADATA = {
  0: { label: "No priority", rank: 4 },
  1: { label: "Urgent", rank: 0 },
  2: { label: "High", rank: 1 },
  3: { label: "Medium", rank: 2 },
  4: { label: "Low", rank: 3 },
} as const satisfies Record<IssuePriority, IssuePriorityMetadata>;

export function getIssuePriorityLabel(priority: IssuePriority): string {
  return ISSUE_PRIORITY_METADATA[priority].label;
}

export function getIssuePriorityRank(priority: IssuePriority): number {
  return ISSUE_PRIORITY_METADATA[priority].rank;
}

/**
 * Returns the first parent cycle found in the issue graph. Each cycle member is
 * returned once; the first ID is not repeated at the end of the array.
 */
export function findIssueParentCycle(
  issues: readonly Pick<Issue, "id" | "parentId">[],
): Id[] | null {
  const issuesById = new Map(issues.map((issue) => [issue.id, issue]));
  const exhausted = new Set<Id>();

  for (const issue of issues) {
    if (exhausted.has(issue.id)) {
      continue;
    }

    const path: Id[] = [];
    const indexInPath = new Map<Id, number>();
    let currentId: Id | null = issue.id;

    while (currentId !== null && issuesById.has(currentId)) {
      const cycleStart = indexInPath.get(currentId);
      if (cycleStart !== undefined) {
        return path.slice(cycleStart);
      }

      if (exhausted.has(currentId)) {
        break;
      }

      indexInPath.set(currentId, path.length);
      path.push(currentId);
      currentId = issuesById.get(currentId)?.parentId ?? null;
    }

    for (const pathId of path) {
      exhausted.add(pathId);
    }
  }

  return null;
}

export function hasIssueParentCycle(
  issues: readonly Pick<Issue, "id" | "parentId">[],
): boolean {
  return findIssueParentCycle(issues) !== null;
}

/**
 * Checks a proposed parent assignment before it is persisted. Attaching an
 * issue to an already-cyclic ancestry is rejected as well, even if the new
 * issue would not itself be one of the pre-existing cycle members.
 */
export function wouldCreateIssueParentCycle(
  issues: readonly Pick<Issue, "id" | "parentId">[],
  issueId: Id,
  proposedParentId: Id | null,
): boolean {
  if (proposedParentId === null) {
    return false;
  }

  if (proposedParentId === issueId) {
    return true;
  }

  const issuesById = new Map(issues.map((issue) => [issue.id, issue]));
  const visited = new Set<Id>();
  let currentId: Id | null = proposedParentId;

  while (currentId !== null) {
    if (currentId === issueId || visited.has(currentId)) {
      return true;
    }

    visited.add(currentId);
    currentId = issuesById.get(currentId)?.parentId ?? null;
  }

  return false;
}
