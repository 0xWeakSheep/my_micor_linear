import type { Comment, Id, Issue, ViewFilters } from "../../lib/domain";
import { getIssuePriorityRank } from "../issues/logic";

export interface IssueFilterContext {
  comments?: readonly Pick<Comment, "issueId" | "body">[];
}

export type IssueSortField =
  | "manual"
  | "priority"
  | "createdAt"
  | "updatedAt"
  | "dueDate"
  | "title"
  | "identifier"
  | "estimate";

export interface IssueSortOptions {
  field: IssueSortField;
  direction?: "asc" | "desc";
}

export type IssueGroupField =
  | "status"
  | "assignee"
  | "project"
  | "priority"
  | "cycle"
  | "label"
  | "parent"
  | "team";

export type IssueGroupValue = Id | Issue["priority"] | null;

export interface IssueGroup {
  key: string;
  value: IssueGroupValue;
  issues: Issue[];
}

type IssuePredicate = (issue: Issue) => boolean;

function hasValues<T>(values: readonly T[] | undefined): values is readonly T[] {
  return values !== undefined && values.length > 0;
}

function normalizeSearchValue(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase().trim();
}

function searchTokens(query: string): string[] {
  return normalizeSearchValue(query).split(/\s+/u).filter(Boolean);
}

function compactIdentifier(value: string): string {
  return normalizeSearchValue(value).replace(/[^a-z0-9]/gu, "");
}

export function matchesIssueSearch(
  issue: Pick<Issue, "identifier" | "title" | "description">,
  query: string,
  commentBodies: readonly string[] = [],
): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) {
    return true;
  }

  const normalizedIdentifier = normalizeSearchValue(issue.identifier);
  const compactIssueIdentifier = compactIdentifier(issue.identifier);
  const haystack = normalizeSearchValue(
    [issue.identifier, issue.title, issue.description, ...commentBodies].join("\n"),
  );

  return tokens.every((token) => {
    if (haystack.includes(token) || normalizedIdentifier.includes(token)) {
      return true;
    }

    const compactToken = compactIdentifier(token);
    return compactToken.length > 0 && compactIssueIdentifier.includes(compactToken);
  });
}

function indexCommentBodies(
  comments: readonly Pick<Comment, "issueId" | "body">[],
): Map<Id, string[]> {
  const bodiesByIssue = new Map<Id, string[]>();

  for (const comment of comments) {
    const bodies = bodiesByIssue.get(comment.issueId);
    if (bodies) {
      bodies.push(comment.body);
    } else {
      bodiesByIssue.set(comment.issueId, [comment.body]);
    }
  }

  return bodiesByIssue;
}

export function searchIssues(
  issues: readonly Issue[],
  query: string,
  comments: readonly Pick<Comment, "issueId" | "body">[] = [],
): Issue[] {
  const commentBodies = indexCommentBodies(comments);
  return issues.filter((issue) =>
    matchesIssueSearch(issue, query, commentBodies.get(issue.id) ?? []),
  );
}

/**
 * Within one filter field, selected values use OR semantics. Across fields,
 * predicates follow ViewFilters.operator (AND by default). Archived issues are
 * excluded unless explicitly included, and trashed issues are always excluded.
 */
export function filterIssues(
  issues: readonly Issue[],
  filters: ViewFilters,
  context: IssueFilterContext = {},
): Issue[] {
  const predicates: IssuePredicate[] = [];
  const commentBodies = indexCommentBodies(context.comments ?? []);

  if (hasValues(filters.teamIds)) {
    const selected = new Set(filters.teamIds);
    predicates.push((issue) => selected.has(issue.teamId));
  }

  if (hasValues(filters.statusIds)) {
    const selected = new Set(filters.statusIds);
    predicates.push((issue) => selected.has(issue.statusId));
  }

  if (hasValues(filters.priorities)) {
    const selected = new Set(filters.priorities);
    predicates.push((issue) => selected.has(issue.priority));
  }

  if (hasValues(filters.assigneeIds)) {
    const selected = new Set(filters.assigneeIds);
    predicates.push(
      (issue) => issue.assigneeId !== null && selected.has(issue.assigneeId),
    );
  }

  if (hasValues(filters.labelIds)) {
    const selected = new Set(filters.labelIds);
    predicates.push((issue) => issue.labelIds.some((labelId) => selected.has(labelId)));
  }

  if (hasValues(filters.projectIds)) {
    const selected = new Set(filters.projectIds);
    predicates.push(
      (issue) => issue.projectId !== null && selected.has(issue.projectId),
    );
  }

  if (hasValues(filters.cycleIds)) {
    const selected = new Set(filters.cycleIds);
    predicates.push((issue) => issue.cycleId !== null && selected.has(issue.cycleId));
  }

  if (hasValues(filters.creatorIds)) {
    const selected = new Set(filters.creatorIds);
    predicates.push((issue) => selected.has(issue.creatorId));
  }

  if (filters.search?.trim()) {
    predicates.push((issue) =>
      matchesIssueSearch(
        issue,
        filters.search ?? "",
        commentBodies.get(issue.id) ?? [],
      ),
    );
  }

  return issues.filter((issue) => {
    if (issue.trashedAt !== null) {
      return false;
    }

    if (!filters.includeArchived && issue.archivedAt !== null) {
      return false;
    }

    if (predicates.length === 0) {
      return true;
    }

    return filters.operator === "or"
      ? predicates.some((predicate) => predicate(issue))
      : predicates.every((predicate) => predicate(issue));
  });
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function parseDate(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function compareNullable<T>(
  left: T | null,
  right: T | null,
  compare: (leftValue: T, rightValue: T) => number,
  direction: "asc" | "desc",
): number {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  const result = compare(left, right);
  return direction === "desc" ? -result : result;
}

function compareIssueValues(
  left: Issue,
  right: Issue,
  options: Required<IssueSortOptions>,
): number {
  const numericCompare = (leftValue: number, rightValue: number) =>
    leftValue - rightValue;

  switch (options.field) {
    case "manual":
      return compareNullable(
        left.sortOrder,
        right.sortOrder,
        numericCompare,
        options.direction,
      );
    case "priority":
      return compareNullable(
        left.priority === 0 ? null : getIssuePriorityRank(left.priority),
        right.priority === 0 ? null : getIssuePriorityRank(right.priority),
        numericCompare,
        options.direction,
      );
    case "createdAt":
      return compareNullable(
        parseDate(left.createdAt),
        parseDate(right.createdAt),
        numericCompare,
        options.direction,
      );
    case "updatedAt":
      return compareNullable(
        parseDate(left.updatedAt),
        parseDate(right.updatedAt),
        numericCompare,
        options.direction,
      );
    case "dueDate":
      return compareNullable(
        parseDate(left.dueDate),
        parseDate(right.dueDate),
        numericCompare,
        options.direction,
      );
    case "title":
      return compareNullable(left.title, right.title, compareStrings, options.direction);
    case "identifier":
      return compareNullable(
        left.identifier,
        right.identifier,
        compareStrings,
        options.direction,
      );
    case "estimate":
      return compareNullable(
        left.estimate,
        right.estimate,
        numericCompare,
        options.direction,
      );
  }
}

/** Returns a stable, non-mutating sort. Missing values remain last in either direction. */
export function sortIssues(
  issues: readonly Issue[],
  options: IssueSortOptions,
): Issue[] {
  const resolvedOptions: Required<IssueSortOptions> = {
    field: options.field,
    direction: options.direction ?? "asc",
  };

  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((left, right) => {
      const result = compareIssueValues(left.issue, right.issue, resolvedOptions);
      return result === 0 ? left.index - right.index : result;
    })
    .map(({ issue }) => issue);
}

function issueGroupValues(issue: Issue, field: IssueGroupField): IssueGroupValue[] {
  switch (field) {
    case "status":
      return [issue.statusId];
    case "assignee":
      return [issue.assigneeId];
    case "project":
      return [issue.projectId];
    case "priority":
      return [issue.priority];
    case "cycle":
      return [issue.cycleId];
    case "label":
      return issue.labelIds.length === 0 ? [null] : [...new Set(issue.labelIds)];
    case "parent":
      return [issue.parentId];
    case "team":
      return [issue.teamId];
  }
}

function issueGroupKey(value: IssueGroupValue): string {
  if (value === null) {
    return "none";
  }

  return `${typeof value}:${value}`;
}

/**
 * Label grouping intentionally places a multi-label issue in each matching
 * group, mirroring a faceted label view. Other fields place an issue once.
 */
export function groupIssues(
  issues: readonly Issue[],
  field: IssueGroupField,
): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();

  for (const issue of issues) {
    for (const value of issueGroupValues(issue, field)) {
      const key = issueGroupKey(value);
      const existing = groups.get(key);
      if (existing) {
        existing.issues.push(issue);
      } else {
        groups.set(key, { key, value, issues: [issue] });
      }
    }
  }

  const result = [...groups.values()];
  if (field === "priority") {
    result.sort((left, right) => {
      const leftPriority = left.value as Issue["priority"];
      const rightPriority = right.value as Issue["priority"];
      return getIssuePriorityRank(leftPriority) - getIssuePriorityRank(rightPriority);
    });
  }

  return result;
}
