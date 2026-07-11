import type { Cycle, Id, Issue, Project, WorkflowState } from "../../lib/domain";

export interface ProgressOptions {
  /** Linear treats an unestimated issue as one point unless configured otherwise. */
  unestimatedValue?: number;
  mode?: "effort" | "issues";
}

export interface ProgressSummary {
  /** Canceled issues are excluded from total scope. Trashed issues are ignored. */
  totalIssues: number;
  completedIssues: number;
  activeIssues: number;
  canceledIssues: number;
  totalEffort: number;
  completedEffort: number;
  remainingEffort: number;
  issueProgress: number;
  effortProgress: number;
  progress: number;
}

export interface CycleVelocityPoint {
  cycleId: Id;
  cycleNumber: number;
  cycleName: string;
  startDate: string;
  endDate: string;
  completedIssues: number;
  completedEffort: number;
}

export interface CycleVelocityOptions extends ProgressOptions {
  /** The latest three completed cycles are Linear's default velocity window. */
  windowSize?: number;
  /** Only cycles ending on or before this instant are considered. */
  before?: string | Date;
}

export interface CycleVelocitySummary {
  cycles: CycleVelocityPoint[];
  cyclesConsidered: number;
  totalCompletedIssues: number;
  totalCompletedEffort: number;
  averageCompletedIssues: number;
  averageCompletedEffort: number;
}

type ProgressState = "active" | "completed" | "canceled";

function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function percentage(completed: number, total: number): number {
  return total <= 0 ? 0 : round((completed / total) * 100);
}

function resolvedUnestimatedValue(options: ProgressOptions): number {
  const value = options.unestimatedValue ?? 1;
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

export function getIssueEffort(
  issue: Pick<Issue, "estimate">,
  options: ProgressOptions = {},
): number {
  const fallback = resolvedUnestimatedValue(options);
  if (issue.estimate === null) {
    return fallback;
  }

  return Number.isFinite(issue.estimate) && issue.estimate >= 0
    ? issue.estimate
    : fallback;
}

function issueProgressState(
  issue: Pick<Issue, "statusId" | "completedAt" | "canceledAt">,
  statesById: ReadonlyMap<Id, WorkflowState>,
): ProgressState {
  const state = statesById.get(issue.statusId);

  if (state?.type === "completed") {
    return "completed";
  }

  if (state?.type === "canceled") {
    return "canceled";
  }

  // Imported data can reference a status that is not present locally. In that
  // case, terminal timestamps are the safest available fallback.
  if (!state && issue.completedAt !== null) {
    return "completed";
  }

  if (!state && issue.canceledAt !== null) {
    return "canceled";
  }

  return "active";
}

/**
 * Calculates scope progress without mutating input. Archived issues remain in
 * historical statistics; trashed issues do not. Canceled work is reported but
 * removed from the completion denominator.
 */
export function calculateProgress(
  issues: readonly Issue[],
  states: readonly WorkflowState[],
  options: ProgressOptions = {},
): ProgressSummary {
  const statesById = new Map(states.map((state) => [state.id, state]));
  let totalIssues = 0;
  let completedIssues = 0;
  let canceledIssues = 0;
  let totalEffort = 0;
  let completedEffort = 0;

  for (const issue of issues) {
    if (issue.trashedAt !== null) {
      continue;
    }

    const state = issueProgressState(issue, statesById);
    if (state === "canceled") {
      canceledIssues += 1;
      continue;
    }

    const effort = getIssueEffort(issue, options);
    totalIssues += 1;
    totalEffort += effort;

    if (state === "completed") {
      completedIssues += 1;
      completedEffort += effort;
    }
  }

  const issueProgress = percentage(completedIssues, totalIssues);
  const effortProgress =
    totalEffort === 0 ? issueProgress : percentage(completedEffort, totalEffort);

  return {
    totalIssues,
    completedIssues,
    activeIssues: totalIssues - completedIssues,
    canceledIssues,
    totalEffort: round(totalEffort),
    completedEffort: round(completedEffort),
    remainingEffort: round(totalEffort - completedEffort),
    issueProgress,
    effortProgress,
    progress: options.mode === "issues" ? issueProgress : effortProgress,
  };
}

function entityId(entity: Id | Pick<Project | Cycle, "id">): Id {
  return typeof entity === "string" ? entity : entity.id;
}

export function calculateProjectProgress(
  project: Id | Pick<Project, "id">,
  issues: readonly Issue[],
  states: readonly WorkflowState[],
  options: ProgressOptions = {},
): ProgressSummary {
  const projectId = entityId(project);
  return calculateProgress(
    issues.filter((issue) => issue.projectId === projectId),
    states,
    options,
  );
}

export function calculateCycleProgress(
  cycle: Id | Pick<Cycle, "id">,
  issues: readonly Issue[],
  states: readonly WorkflowState[],
  options: ProgressOptions = {},
): ProgressSummary {
  const cycleId = entityId(cycle);
  return calculateProgress(
    issues.filter((issue) => issue.cycleId === cycleId),
    states,
    options,
  );
}

function timestamp(value: string | Date): number | null {
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(result) ? null : result;
}

function compareCyclesNewestFirst(left: Cycle, right: Cycle): number {
  const leftEnd = timestamp(left.endDate);
  const rightEnd = timestamp(right.endDate);

  if (leftEnd !== null && rightEnd !== null && leftEnd !== rightEnd) {
    return rightEnd - leftEnd;
  }

  if (leftEnd === null && rightEnd !== null) {
    return 1;
  }

  if (leftEnd !== null && rightEnd === null) {
    return -1;
  }

  return right.number - left.number;
}

function emptyVelocity(): CycleVelocitySummary {
  return {
    cycles: [],
    cyclesConsidered: 0,
    totalCompletedIssues: 0,
    totalCompletedEffort: 0,
    averageCompletedIssues: 0,
    averageCompletedEffort: 0,
  };
}

/**
 * Calculates velocity from the most recent completed cycles and returns points
 * in chronological order for direct charting.
 */
export function calculateCycleVelocity(
  cycles: readonly Cycle[],
  issues: readonly Issue[],
  states: readonly WorkflowState[],
  options: CycleVelocityOptions = {},
): CycleVelocitySummary {
  const requestedWindow = options.windowSize ?? 3;
  const windowSize = Number.isFinite(requestedWindow)
    ? Math.max(0, Math.floor(requestedWindow))
    : 3;

  if (windowSize === 0) {
    return emptyVelocity();
  }

  const beforeTimestamp = options.before === undefined ? null : timestamp(options.before);
  const selectedCycles = cycles
    .filter((cycle) => {
      if (cycle.status !== "completed") {
        return false;
      }

      if (beforeTimestamp === null) {
        return true;
      }

      const cycleEnd = timestamp(cycle.endDate);
      return cycleEnd !== null && cycleEnd <= beforeTimestamp;
    })
    .sort(compareCyclesNewestFirst)
    .slice(0, windowSize)
    .reverse();

  if (selectedCycles.length === 0) {
    return emptyVelocity();
  }

  const points = selectedCycles.map((cycle): CycleVelocityPoint => {
    const progress = calculateCycleProgress(cycle, issues, states, options);
    return {
      cycleId: cycle.id,
      cycleNumber: cycle.number,
      cycleName: cycle.name,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      completedIssues: progress.completedIssues,
      completedEffort: progress.completedEffort,
    };
  });

  const totalCompletedIssues = points.reduce(
    (total, point) => total + point.completedIssues,
    0,
  );
  const totalCompletedEffort = points.reduce(
    (total, point) => total + point.completedEffort,
    0,
  );
  const cyclesConsidered = points.length;

  return {
    cycles: points,
    cyclesConsidered,
    totalCompletedIssues,
    totalCompletedEffort: round(totalCompletedEffort),
    averageCompletedIssues: round(totalCompletedIssues / cyclesConsidered),
    averageCompletedEffort: round(totalCompletedEffort / cyclesConsidered),
  };
}
