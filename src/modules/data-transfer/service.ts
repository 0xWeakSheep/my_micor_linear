import "server-only";

import { z } from "zod";

import {
  getTeamPermissionContext,
  hasTeamPermission,
  requireWorkspacePermission,
} from "@/lib/auth";
import { getBootstrapData } from "@/lib/bootstrap";
import type { Database } from "@/lib/db";
import { getDatabase, transaction } from "@/lib/db";
import type { BootstrapData, Issue } from "@/lib/domain";
import { createId, slugify } from "@/lib/security";
import {
  DomainValidationError,
  finishMutation,
  type MutationResult,
  recordAudit,
  ResourceNotFoundError,
} from "@/modules/shared/mutation";
import { CsvFormatError, csvRecords, stringifyCsv } from "./format";

export type DataFormat = "json" | "csv";

export interface DataExportResult {
  format: DataFormat;
  filename: string;
  mime: string;
  content: string;
}

export interface DataImportResult {
  format: DataFormat;
  filename: string;
  created: {
    teams: number;
    states: number;
    labels: number;
    projects: number;
    cycles: number;
    issues: number;
    comments: number;
  };
  skipped: number;
  warnings: string[];
}

interface ImportTeam {
  id: string;
  name: string;
  key: string;
  description?: string;
  color?: string;
  icon?: string;
  isPrivate?: boolean;
}

interface ImportState {
  id: string;
  teamId: string;
  name: string;
  type: string;
  color?: string;
  position?: number;
}

interface ImportLabel {
  id: string;
  name: string;
  color?: string;
  description?: string;
  groupName?: string | null;
}

interface ImportProject {
  id: string;
  name: string;
  slug?: string;
  summary?: string;
  description?: string;
  status?: string;
  priority?: number;
  color?: string;
  icon?: string;
  startDate?: string | null;
  targetDate?: string | null;
  teamIds?: string[];
}

interface ImportCycle {
  id: string;
  teamId: string;
  number: number;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  status?: string;
}

interface ImportIssue {
  id: string;
  teamId: string;
  identifier?: string;
  title: string;
  description?: string;
  statusId?: string;
  statusName?: string;
  priority?: number;
  assigneeId?: string | null;
  assigneeEmail?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  cycleId?: string | null;
  parentId?: string | null;
  estimate?: number | null;
  dueDate?: string | null;
  sortOrder?: number;
  labelIds?: string[];
  labelNames?: string[];
  createdAt?: string;
  updatedAt?: string;
}

interface ImportComment {
  id: string;
  issueId: string;
  authorId?: string;
  authorEmail?: string;
  parentId?: string | null;
  body: string;
  createdAt?: string;
  updatedAt?: string;
}

interface ImportRelation {
  issueId: string;
  relatedIssueId: string;
  type: "related" | "blocks" | "duplicate";
}

interface NormalizedImport {
  teams: ImportTeam[];
  states: ImportState[];
  labels: ImportLabel[];
  projects: ImportProject[];
  cycles: ImportCycle[];
  issues: ImportIssue[];
  comments: ImportComment[];
  relations: ImportRelation[];
  memberships: Array<{ userId: string; user: { email: string } }>;
}

const exportPayloadSchema = z.object({
  format: z.enum(["json", "csv"]),
  scope: z.literal("workspace").default("workspace"),
}).strict();

const importPayloadSchema = z.object({
  format: z.enum(["json", "csv"]),
  filename: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(20 * 1024 * 1024),
}).strict();

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainValidationError("Import file must contain an object.");
  }
  return value as Record<string, unknown>;
}

function arrayValue<T>(record: Record<string, unknown>, key: string): T[] {
  const value = record[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeJsonImport(content: string): NormalizedImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new DomainValidationError("JSON file is not valid JSON.");
  }
  const root = asRecord(parsed);
  const data = "data" in root ? asRecord(root.data) : root;
  const issues = arrayValue<ImportIssue>(data, "issues");
  if (issues.some((issue) => !issue || typeof issue.title !== "string" || typeof issue.teamId !== "string")) {
    throw new DomainValidationError("JSON issues must include title and teamId.");
  }
  return {
    teams: arrayValue<ImportTeam>(data, "teams"),
    states: arrayValue<ImportState>(data, "states"),
    labels: arrayValue<ImportLabel>(data, "labels"),
    projects: arrayValue<ImportProject>(data, "projects"),
    cycles: arrayValue<ImportCycle>(data, "cycles"),
    issues,
    comments: arrayValue<ImportComment>(data, "comments"),
    relations: arrayValue<ImportRelation>(data, "relations"),
    memberships: arrayValue<NormalizedImport["memberships"][number]>(data, "memberships"),
  };
}

function cell(record: Record<string, string>, ...names: string[]): string {
  const entries = new Map(Object.entries(record).map(([key, value]) => [key.trim().toLowerCase(), value.trim()]));
  for (const name of names) {
    const value = entries.get(name.toLowerCase());
    if (value !== undefined) return value;
  }
  return "";
}

function priorityValue(value: string): Issue["priority"] {
  const normalized = value.trim().toLowerCase();
  const named: Record<string, Issue["priority"]> = {
    urgent: 1, high: 2, medium: 3, low: 4, "no priority": 0,
    "紧急": 1, "高": 2, "中": 3, "低": 4,
  };
  if (normalized in named) return named[normalized]!;
  const number = Number(normalized);
  return Number.isInteger(number) && number >= 0 && number <= 4 ? (number as Issue["priority"]) : 0;
}

function normalizeCsvImport(content: string): NormalizedImport {
  let records: Array<Record<string, string>>;
  try {
    records = csvRecords(content);
  } catch (error) {
    throw new DomainValidationError(error instanceof CsvFormatError ? error.message : "CSV file is invalid.");
  }
  if (records.length === 0) throw new DomainValidationError("CSV contains no data rows.");
  const teams = new Map<string, ImportTeam>();
  const labels = new Map<string, ImportLabel>();
  const projects = new Map<string, ImportProject>();
  const issues: ImportIssue[] = records.map((record, index) => {
    const title = cell(record, "Title", "标题");
    const teamName = cell(record, "Team", "Team Key", "团队");
    if (!title || !teamName) throw new DomainValidationError(`CSV row ${index + 2} requires Title and Team.`);
    const teamKey = teamName.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8) || "IMP";
    teams.set(teamKey, { id: `csv-team-${teamKey}`, name: teamName, key: teamKey });
    const labelNames = cell(record, "Labels", "标签").split(/[|;]/).map((value) => value.trim()).filter(Boolean);
    for (const name of labelNames) labels.set(name.toLowerCase(), { id: `csv-label-${name.toLowerCase()}`, name });
    const projectName = cell(record, "Project", "项目") || null;
    if (projectName) projects.set(projectName.toLowerCase(), { id: `csv-project-${projectName.toLowerCase()}`, name: projectName, teamIds: [`csv-team-${teamKey}`] });
    const estimateText = cell(record, "Estimate", "估点");
    return {
      id: `csv-issue-${index + 1}`,
      identifier: cell(record, "Identifier", "ID", "编号") || undefined,
      teamId: `csv-team-${teamKey}`,
      title,
      description: cell(record, "Description", "描述"),
      statusName: cell(record, "Status", "状态") || undefined,
      priority: priorityValue(cell(record, "Priority", "优先级")),
      assigneeEmail: cell(record, "Assignee Email", "Assignee", "负责人") || null,
      projectName,
      estimate: estimateText && Number.isFinite(Number(estimateText)) ? Number(estimateText) : null,
      dueDate: cell(record, "Due Date", "DueDate", "截止日期") || null,
      labelNames,
      createdAt: cell(record, "Created At", "CreatedAt", "创建时间") || undefined,
      updatedAt: cell(record, "Updated At", "UpdatedAt", "更新时间") || undefined,
    };
  });
  return {
    teams: [...teams.values()], states: [], labels: [...labels.values()], projects: [...projects.values()],
    cycles: [], issues, comments: [], relations: [], memberships: [],
  };
}

function safeDate(value: string | undefined, fallback: string): string {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}

function uniqueTeamKey(database: Database, workspaceId: string, desired: string): string {
  const base = (desired.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6) || "IMP").padEnd(2, "X");
  let key = base;
  let suffix = 2;
  while (database.prepare("SELECT 1 FROM teams WHERE workspace_id = ? AND key = ? COLLATE NOCASE").get(workspaceId, key)) {
    key = `${base.slice(0, 5)}${suffix}`.slice(0, 8);
    suffix += 1;
  }
  return key;
}

function createImportedTeam(database: Database, workspaceId: string, actorId: string, source: ImportTeam, now: string): string {
  const existing = database.prepare("SELECT id FROM teams WHERE workspace_id = ? AND (key = ? COLLATE NOCASE OR name = ? COLLATE NOCASE)").get(workspaceId, source.key, source.name) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = createId("team");
  const key = uniqueTeamKey(database, workspaceId, source.key);
  database.prepare(`INSERT INTO teams(id, workspace_id, name, key, description, color, icon, is_private, triage_enabled, next_issue_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`)
    .run(id, workspaceId, source.name.slice(0, 100), key, source.description ?? "", source.color ?? "#5E6AD2", source.icon ?? key[0]!, source.isPrivate ? 1 : 0, now, now);
  database.prepare("INSERT INTO team_members(team_id, user_id, role, joined_at) VALUES (?, ?, 'lead', ?)").run(id, actorId, now);
  const defaults: Array<[string, string, string, number, number]> = [
    ["Backlog", "backlog", "#6B7280", 100, 1], ["Todo", "unstarted", "#E2B340", 200, 0],
    ["In Progress", "started", "#5E6AD2", 300, 0], ["Done", "completed", "#5EBD8C", 400, 0],
    ["Canceled", "canceled", "#9CA3AF", 500, 0],
  ];
  const insert = database.prepare("INSERT INTO workflow_states(id, team_id, name, type, color, position, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const [name, type, color, position, isDefault] of defaults) insert.run(createId("state"), id, name, type, color, position, isDefault, now);
  return id;
}

function requireImportTeamAccess(actorId: string, teamId: string): void {
  if (!hasTeamPermission(getTeamPermissionContext(actorId, teamId), "edit_issue")) {
    throw new ResourceNotFoundError("Team not found.");
  }
}

function requireImportProjectAccess(
  database: Database,
  workspaceId: string,
  actorId: string,
  projectId: string,
): void {
  const project = database
    .prepare(
      "SELECT 1 FROM projects WHERE id = ? AND workspace_id = ? AND trashed_at IS NULL",
    )
    .get(projectId, workspaceId);
  if (!project) throw new ResourceNotFoundError("Project not found.");
  const teamIds = database
    .prepare("SELECT team_id AS teamId FROM project_teams WHERE project_id = ?")
    .all(projectId) as Array<{ teamId: string }>;
  if (
    teamIds.length > 0 &&
    !teamIds.some(({ teamId }) =>
      hasTeamPermission(getTeamPermissionContext(actorId, teamId), "read"),
    )
  ) {
    throw new ResourceNotFoundError("Project not found.");
  }
}

function buildCsv(data: BootstrapData): string {
  const teams = new Map(data.teams.map((item) => [item.id, item]));
  const states = new Map(data.states.map((item) => [item.id, item]));
  const members = new Map(data.memberships.map((item) => [item.userId, item]));
  const projects = new Map(data.projects.map((item) => [item.id, item]));
  const cycles = new Map(data.cycles.map((item) => [item.id, item]));
  const labels = new Map(data.labels.map((item) => [item.id, item]));
  const headers = ["Identifier", "Title", "Description", "Team", "Status", "Priority", "Assignee Email", "Project", "Cycle", "Labels", "Estimate", "Due Date", "Created At", "Updated At"];
  const rows = data.issues.filter((issue) => !issue.trashedAt).map((issue) => [
    issue.identifier, issue.title, issue.description, teams.get(issue.teamId)?.key ?? "",
    states.get(issue.statusId)?.name ?? "", issue.priority,
    issue.assigneeId ? members.get(issue.assigneeId)?.user.email ?? "" : "",
    issue.projectId ? projects.get(issue.projectId)?.name ?? "" : "",
    issue.cycleId ? cycles.get(issue.cycleId)?.name ?? "" : "",
    issue.labelIds.map((id) => labels.get(id)?.name).filter(Boolean).join("|"),
    issue.estimate, issue.dueDate, issue.createdAt, issue.updatedAt,
  ]);
  return stringifyCsv(headers, rows);
}

function exportSnapshot(data: BootstrapData): Record<string, unknown> {
  return {
    schema: "micro-linear.workspace.v1",
    exportedAt: new Date().toISOString(),
    workspace: data.workspace,
    data: {
      memberships: data.memberships.map(({ id, userId, role, status, joinedAt, user }) => ({ id, userId, role, status, joinedAt, user })),
      teams: data.teams, teamMembers: data.teamMembers, states: data.states, labels: data.labels,
      issues: data.issues.filter((issue) => !issue.trashedAt), relations: data.relations,
      comments: data.comments, attachments: data.attachments,
      projects: data.projects, milestones: data.milestones, projectUpdates: data.projectUpdates,
      projectDependencies: data.projectDependencies, cycles: data.cycles, initiatives: data.initiatives,
      documents: data.documents, templates: data.templates, recurringIssues: data.recurringIssues,
      views: data.views,
    },
  };
}

export function exportWorkspaceData(workspaceId: string, actorId: string, input: unknown): DataExportResult {
  requireWorkspacePermission(actorId, workspaceId, "manage_settings");
  const parsed = exportPayloadSchema.safeParse(input);
  if (!parsed.success) throw new DomainValidationError("Export format must be json or csv.");
  const workspace = getDatabase().prepare("SELECT slug FROM workspaces WHERE id = ?").get(workspaceId) as { slug: string } | undefined;
  if (!workspace) throw new ResourceNotFoundError("Workspace not found.");
  const data = getBootstrapData(actorId, workspace.slug);
  const date = new Date().toISOString().slice(0, 10);
  const result: DataExportResult = parsed.data.format === "json"
    ? { format: "json", filename: `${workspace.slug}-export-${date}.json`, mime: "application/json; charset=utf-8", content: JSON.stringify(exportSnapshot(data), null, 2) }
    : { format: "csv", filename: `${workspace.slug}-issues-${date}.csv`, mime: "text/csv; charset=utf-8", content: buildCsv(data) };
  transaction((database) => {
    const now = new Date().toISOString();
    recordAudit(database, { workspaceId, actorId, action: "data.exported", entityType: "workspace", entityId: workspaceId, metadata: { format: result.format }, createdAt: now });
  });
  return result;
}

export function importWorkspaceData(workspaceId: string, actorId: string, input: unknown): DataImportResult {
  requireWorkspacePermission(actorId, workspaceId, "manage_settings");
  const parsed = importPayloadSchema.safeParse(input);
  if (!parsed.success) throw new DomainValidationError(parsed.error.issues[0]?.message ?? "Invalid import request.");
  const normalized = parsed.data.format === "json" ? normalizeJsonImport(parsed.data.content) : normalizeCsvImport(parsed.data.content);
  const now = new Date().toISOString();
  return transaction((database) => {
    if (!database.prepare("SELECT 1 FROM workspaces WHERE id = ?").get(workspaceId)) throw new ResourceNotFoundError("Workspace not found.");
    const created = { teams: 0, states: 0, labels: 0, projects: 0, cycles: 0, issues: 0, comments: 0 };
    const warnings: string[] = [];
    let skipped = 0;
    const teamMap = new Map<string, string>();
    for (const source of normalized.teams) {
      const before = database.prepare("SELECT id FROM teams WHERE workspace_id = ? AND (key = ? COLLATE NOCASE OR name = ? COLLATE NOCASE)").get(workspaceId, source.key, source.name) as { id: string } | undefined;
      const id = before?.id ?? createImportedTeam(database, workspaceId, actorId, source, now);
      if (before) requireImportTeamAccess(actorId, id);
      if (!before) created.teams += 1;
      teamMap.set(source.id, id);
    }
    const stateMap = new Map<string, string>();
    for (const source of normalized.states) {
      const teamId = teamMap.get(source.teamId);
      if (!teamId) { warnings.push(`Skipped state ${source.name}: team is unavailable.`); continue; }
      const existing = database.prepare("SELECT id FROM workflow_states WHERE team_id = ? AND name = ? COLLATE NOCASE").get(teamId, source.name) as { id: string } | undefined;
      if (existing) stateMap.set(source.id, existing.id);
      else {
        const id = createId("state");
        const type = ["triage", "backlog", "unstarted", "started", "completed", "canceled"].includes(source.type) ? source.type : "unstarted";
        const position = source.position ?? Number((database.prepare("SELECT COALESCE(MAX(position), 0) + 100 AS value FROM workflow_states WHERE team_id = ?").get(teamId) as { value: number }).value);
        database.prepare("INSERT INTO workflow_states(id, team_id, name, type, color, position, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)").run(id, teamId, source.name, type, source.color ?? "#8B8D98", position, now);
        stateMap.set(source.id, id); created.states += 1;
      }
    }
    const labelMap = new Map<string, string>();
    for (const source of normalized.labels) {
      const existing = database.prepare("SELECT id FROM labels WHERE workspace_id = ? AND team_id IS NULL AND name = ? COLLATE NOCASE").get(workspaceId, source.name) as { id: string } | undefined;
      if (existing) labelMap.set(source.id, existing.id);
      else {
        const id = createId("label");
        database.prepare("INSERT INTO labels(id, workspace_id, team_id, name, color, description, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)").run(id, workspaceId, source.name, source.color ?? "#8B8D98", source.description ?? "", now);
        labelMap.set(source.id, id); created.labels += 1;
      }
    }
    const projectMap = new Map<string, string>();
    for (const source of normalized.projects) {
      const slug = slugify(source.slug || source.name);
      const existing = database.prepare("SELECT id FROM projects WHERE workspace_id = ? AND (slug = ? OR name = ? COLLATE NOCASE)").get(workspaceId, slug, source.name) as { id: string } | undefined;
      let id = existing?.id;
      if (id) requireImportProjectAccess(database, workspaceId, actorId, id);
      if (!id) {
        id = createId("project");
        const status = ["planned", "started", "paused", "completed", "canceled"].includes(source.status ?? "") ? source.status! : "planned";
        database.prepare(`INSERT INTO projects(id, workspace_id, name, slug, summary, description, status, priority, color, icon, start_date, target_date, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, workspaceId, source.name, slug, source.summary ?? "", source.description ?? "", status, source.priority ?? 0, source.color ?? "#5E6AD2", source.icon ?? "P", source.startDate ?? null, source.targetDate ?? null, Date.now(), now, now);
        created.projects += 1;
      }
      projectMap.set(source.id, id);
      for (const sourceTeamId of source.teamIds ?? []) {
        const teamId = teamMap.get(sourceTeamId);
        if (teamId) database.prepare("INSERT OR IGNORE INTO project_teams(project_id, team_id) VALUES (?, ?)").run(id, teamId);
      }
    }
    const cycleMap = new Map<string, string>();
    for (const source of normalized.cycles) {
      const teamId = teamMap.get(source.teamId); if (!teamId) continue;
      const existing = database.prepare("SELECT id FROM cycles WHERE team_id = ? AND number = ?").get(teamId, source.number) as { id: string } | undefined;
      if (existing) cycleMap.set(source.id, existing.id);
      else if (source.endDate > source.startDate) {
        const id = createId("cycle");
        const status = ["upcoming", "active", "completed"].includes(source.status ?? "") ? source.status! : "upcoming";
        database.prepare(`INSERT INTO cycles(id, team_id, number, name, description, start_date, end_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, teamId, source.number, source.name, source.description ?? "", source.startDate, source.endDate, status, now, now);
        cycleMap.set(source.id, id); created.cycles += 1;
      }
    }
    const emailBySourceUser = new Map(normalized.memberships.map((membership) => [membership.userId, membership.user.email]));
    const localUserByEmail = new Map((database.prepare(`SELECT u.email, u.id FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = ? AND wm.status = 'active'`).all(workspaceId) as Array<{ email: string; id: string }>).map((user) => [user.email.toLowerCase(), user.id]));
    const issueMap = new Map<string, string>();
    const newlyCreated = new Set<string>();
    for (const source of normalized.issues) {
      if (source.identifier) {
        const existing = database.prepare("SELECT id, team_id AS teamId FROM issues WHERE workspace_id = ? AND identifier = ? COLLATE NOCASE").get(workspaceId, source.identifier) as { id: string; teamId: string } | undefined;
        if (existing) {
          requireImportTeamAccess(actorId, existing.teamId);
          issueMap.set(source.id, existing.id); skipped += 1; continue;
        }
      }
      const teamId = teamMap.get(source.teamId);
      if (!teamId) { warnings.push(`Skipped ${source.title}: team is unavailable.`); skipped += 1; continue; }
      const sequence = database.prepare("UPDATE teams SET next_issue_number = next_issue_number + 1, updated_at = ? WHERE id = ? RETURNING key, next_issue_number - 1 AS number").get(now, teamId) as { key: string; number: number };
      const identifier = `${sequence.key}-${sequence.number}`;
      let statusId = source.statusId ? stateMap.get(source.statusId) : undefined;
      if (!statusId && source.statusName) statusId = (database.prepare("SELECT id FROM workflow_states WHERE team_id = ? AND name = ? COLLATE NOCASE").get(teamId, source.statusName) as { id: string } | undefined)?.id;
      statusId ??= (database.prepare("SELECT id FROM workflow_states WHERE team_id = ? ORDER BY is_default DESC, position LIMIT 1").get(teamId) as { id: string }).id;
      const email = source.assigneeEmail || (source.assigneeId ? emailBySourceUser.get(source.assigneeId) : undefined);
      const assigneeId = email ? localUserByEmail.get(email.toLowerCase()) ?? null : null;
      let projectId = source.projectId ? projectMap.get(source.projectId) ?? null : null;
      if (!projectId && source.projectName) {
        projectId = (database.prepare("SELECT id FROM projects WHERE workspace_id = ? AND name = ? COLLATE NOCASE").get(workspaceId, source.projectName) as { id: string } | undefined)?.id ?? null;
        if (projectId) requireImportProjectAccess(database, workspaceId, actorId, projectId);
      }
      const id = createId("issue"); const createdAt = safeDate(source.createdAt, now); const updatedAt = safeDate(source.updatedAt, now);
      database.prepare(`INSERT INTO issues(id, workspace_id, team_id, identifier, number, title, description, status_id, priority, assignee_id, creator_id, project_id, cycle_id, estimate, due_date, sort_order, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(id, workspaceId, teamId, identifier, sequence.number, source.title.slice(0, 500), source.description ?? "", statusId, source.priority ?? 0, assigneeId, actorId, projectId, source.cycleId ? cycleMap.get(source.cycleId) ?? null : null, source.estimate ?? null, source.dueDate ?? null, source.sortOrder ?? Date.now(), createdAt, updatedAt);
      database.prepare("INSERT INTO issue_identifier_aliases(id, workspace_id, issue_id, identifier, is_current, created_at) VALUES (?, ?, ?, ?, 1, ?)").run(createId("alias"), workspaceId, id, identifier, now);
      for (const labelId of source.labelIds ?? []) { const mapped = labelMap.get(labelId); if (mapped) database.prepare("INSERT OR IGNORE INTO issue_labels(issue_id, label_id) VALUES (?, ?)").run(id, mapped); }
      for (const labelName of source.labelNames ?? []) { const mapped = [...normalized.labels].find((label) => label.name.toLowerCase() === labelName.toLowerCase()); const local = mapped ? labelMap.get(mapped.id) : undefined; if (local) database.prepare("INSERT OR IGNORE INTO issue_labels(issue_id, label_id) VALUES (?, ?)").run(id, local); }
      issueMap.set(source.id, id); newlyCreated.add(source.id); created.issues += 1;
    }
    for (const source of normalized.issues) {
      if (!source.parentId || !newlyCreated.has(source.id)) continue;
      const id = issueMap.get(source.id); const parentId = issueMap.get(source.parentId);
      if (id && parentId && id !== parentId) database.prepare("UPDATE issues SET parent_id = ? WHERE id = ?").run(parentId, id);
    }
    const commentMap = new Map<string, string>();
    for (const source of normalized.comments) {
      if (!newlyCreated.has(source.issueId)) continue;
      const issueId = issueMap.get(source.issueId); if (!issueId || !source.body) continue;
      const authorEmail = source.authorEmail || (source.authorId ? emailBySourceUser.get(source.authorId) : undefined);
      const authorId = authorEmail ? localUserByEmail.get(authorEmail.toLowerCase()) ?? actorId : actorId;
      const id = createId("comment"); const createdAt = safeDate(source.createdAt, now);
      database.prepare("INSERT INTO comments(id, issue_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, issueId, authorId, source.body, createdAt, safeDate(source.updatedAt, createdAt));
      commentMap.set(source.id, id); created.comments += 1;
    }
    for (const source of normalized.comments) {
      if (!source.parentId) continue;
      const id = commentMap.get(source.id); const parentId = commentMap.get(source.parentId);
      if (id && parentId && id !== parentId) database.prepare("UPDATE comments SET parent_id = ? WHERE id = ?").run(parentId, id);
    }
    for (const source of normalized.relations) {
      const issueId = issueMap.get(source.issueId); const relatedId = issueMap.get(source.relatedIssueId);
      if (issueId && relatedId && issueId !== relatedId && ["related", "blocks", "duplicate"].includes(source.type)) {
        database.prepare("INSERT OR IGNORE INTO issue_relations(id, issue_id, related_issue_id, type, created_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(createId("rel"), issueId, relatedId, source.type, actorId, now);
      }
    }
    finishMutation(database, { workspaceId, actorId, entityType: "workspace", entityId: workspaceId, eventType: "data.imported", action: "data.imported", metadata: { format: parsed.data.format, created, skipped }, createdAt: now });
    recordAudit(database, { workspaceId, actorId, action: "data.imported", entityType: "workspace", entityId: workspaceId, metadata: { filename: parsed.data.filename, format: parsed.data.format, created, skipped }, createdAt: now });
    return { format: parsed.data.format, filename: parsed.data.filename, created, skipped, warnings: warnings.slice(0, 100) };
  });
}

export function executeDataAction(action: string, workspaceId: string, actorId: string, payload: unknown): MutationResult | null {
  if (action === "data.export") {
    const data = exportWorkspaceData(workspaceId, actorId, payload);
    return { data, eventType: "data.exported", resourceId: workspaceId };
  }
  if (action === "data.import") {
    const data = importWorkspaceData(workspaceId, actorId, payload);
    return { data, eventType: "data.imported", resourceId: workspaceId };
  }
  return null;
}
