import type { Issue, WorkflowState, WorkflowStateType } from "@/lib/domain";

const STATE_TYPE_ORDER: WorkflowStateType[] = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
];

const STATE_TYPE_LABELS: Record<WorkflowStateType, string> = {
  triage: "Triage",
  backlog: "Backlog",
  unstarted: "Todo",
  started: "In Progress",
  completed: "Done",
  canceled: "Canceled",
};

export interface IssueBoardColumn {
  id: string;
  label: string;
  state: WorkflowState;
  stateIds: string[];
  statusId: string | null;
  statusType: WorkflowStateType | null;
}

export interface IssueBoardDropTarget {
  statusId?: string | null;
  statusType?: WorkflowStateType | null;
}

function visibleStates(issues: Issue[], states: WorkflowState[]): WorkflowState[] {
  const teamIds = new Set(issues.map((issue) => issue.teamId));

  return states
    .filter((state) => teamIds.size === 0 || teamIds.has(state.teamId))
    .toSorted((left, right) => left.position - right.position);
}

export function buildIssueBoardColumns(
  issues: Issue[],
  states: WorkflowState[],
): IssueBoardColumn[] {
  const teamIds = new Set(issues.map((issue) => issue.teamId));
  const relevantStates = visibleStates(issues, states);

  if (teamIds.size <= 1) {
    return relevantStates.map((state) => ({
      id: state.id,
      label: state.name,
      state,
      stateIds: [state.id],
      statusId: state.id,
      statusType: null,
    }));
  }

  return STATE_TYPE_ORDER.flatMap((type) => {
    const typeStates = relevantStates.filter((state) => state.type === type);
    if (typeStates.length === 0) return [];

    const names = new Set(typeStates.map((state) => state.name));
    return [{
      id: `type:${type}`,
      label: names.size === 1 ? typeStates[0].name : STATE_TYPE_LABELS[type],
      state: typeStates[0],
      stateIds: typeStates.map((state) => state.id),
      statusId: null,
      statusType: type,
    }];
  });
}

export function resolveIssueBoardStatus(
  issue: Issue,
  target: IssueBoardDropTarget,
  states: WorkflowState[],
): string | null {
  if (target.statusId) {
    const explicitState = states.find(
      (state) => state.id === target.statusId && state.teamId === issue.teamId,
    );
    return explicitState?.id ?? null;
  }

  if (!target.statusType) return null;

  const currentState = states.find(
    (state) => state.id === issue.statusId && state.teamId === issue.teamId,
  );
  if (currentState?.type === target.statusType) return currentState.id;

  return states
    .filter(
      (state) => state.teamId === issue.teamId && state.type === target.statusType,
    )
    .toSorted((left, right) => left.position - right.position)[0]?.id ?? null;
}
