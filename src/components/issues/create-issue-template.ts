import type {
  BootstrapData,
  Issue,
  IssueTemplate,
} from "@/lib/domain";

export interface IssueTemplateFormDefaults {
  statusId: string;
  priority: Issue["priority"];
  assigneeId: string;
  projectId: string;
  cycleId: string;
  labelIds: string[];
  estimate: number | null;
  dueDate: string;
}

type IssueTemplateContext = Pick<
  BootstrapData,
  "states" | "memberships" | "projects" | "cycles" | "labels"
>;

export function applicableIssueTemplates(
  templates: readonly IssueTemplate[],
  teamId: string,
): IssueTemplate[] {
  return templates.filter((template) => template.teamId === null || template.teamId === teamId);
}

function validPriority(value: unknown): value is Issue["priority"] {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 4;
}

function dateInputValue(value: unknown): string {
  if (typeof value !== "string" || value.length > 32) return "";
  const candidate = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(candidate);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? candidate
    : "";
}

export function resolveIssueTemplateDefaults(
  template: IssueTemplate,
  teamId: string,
  fallbackStatusId: string,
  context: IssueTemplateContext,
): IssueTemplateFormDefaults {
  const defaults = template.defaults;
  const teamStateIds = new Set(
    context.states.filter((state) => state.teamId === teamId).map((state) => state.id),
  );
  const statusId =
    typeof defaults.statusId === "string" && teamStateIds.has(defaults.statusId)
      ? defaults.statusId
      : teamStateIds.has(fallbackStatusId)
        ? fallbackStatusId
        : context.states.find((state) => state.teamId === teamId)?.id ?? "";
  const activeMemberIds = new Set(
    context.memberships
      .filter((membership) => membership.status === "active")
      .map((membership) => membership.userId),
  );
  const projectIds = new Set(context.projects.map((project) => project.id));
  const cycleIds = new Set(
    context.cycles.filter((cycle) => cycle.teamId === teamId).map((cycle) => cycle.id),
  );
  const labelIds = new Set(context.labels.map((label) => label.id));

  return {
    statusId,
    priority: validPriority(defaults.priority) ? defaults.priority : 0,
    assigneeId:
      typeof defaults.assigneeId === "string" && activeMemberIds.has(defaults.assigneeId)
        ? defaults.assigneeId
        : "",
    projectId:
      typeof defaults.projectId === "string" && projectIds.has(defaults.projectId)
        ? defaults.projectId
        : "",
    cycleId:
      typeof defaults.cycleId === "string" && cycleIds.has(defaults.cycleId)
        ? defaults.cycleId
        : "",
    labelIds: [...new Set(defaults.labelIds ?? [])].filter((labelId) => labelIds.has(labelId)),
    estimate:
      defaults.estimate === null ||
      (Number.isInteger(defaults.estimate) &&
        Number(defaults.estimate) >= 0 &&
        Number(defaults.estimate) <= 1_000)
        ? defaults.estimate ?? null
        : null,
    dueDate: dateInputValue(defaults.dueDate),
  };
}
