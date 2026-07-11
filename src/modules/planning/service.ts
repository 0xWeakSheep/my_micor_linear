import "server-only";

import { z } from "zod";

import {
  getTeamPermissionContext,
  hasTeamPermission,
  requireTeamPermission,
  requireWorkspacePermission,
} from "@/lib/auth";
import type { Database } from "@/lib/db";
import { getDatabase, transaction, type BindValue } from "@/lib/db";
import type {
  Cycle,
  Initiative,
  Project,
  ProjectDependency,
  ProjectMilestone,
  ProjectUpdate,
} from "@/lib/domain";
import { createId, slugify } from "@/lib/security";
import {
  ConflictError,
  createNotification,
  DomainValidationError,
  finishMutation,
  type MutationResult,
  ResourceNotFoundError,
} from "@/modules/shared/mutation";

interface ProjectRow {
  id: string;
  workspace_id: string;
  team_id: string | null;
  name: string;
  slug: string;
  summary: string;
  description: string;
  status: Project["status"];
  priority: Project["priority"];
  lead_id: string | null;
  color: string;
  icon: string;
  start_date: string | null;
  target_date: string | null;
  archived_at: string | null;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CycleRow {
  id: string;
  team_id: string;
  number: number;
  name: string;
  description: string;
  start_date: string;
  end_date: string;
  status: Cycle["status"];
  created_at: string;
}

interface MilestoneRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  target_date: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

interface ProjectDependencyRow {
  id: string;
  project_id: string;
  depends_on_project_id: string;
  created_at: string;
}

interface InitiativeRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  summary: string;
  description: string;
  status: Initiative["status"];
  priority: Initiative["priority"];
  owner_id: string | null;
  target_date: string | null;
  color: string;
  created_at: string;
}

function getProjectRow(
  database: Database,
  projectId: string,
  options: { includeArchived?: boolean } = {},
): ProjectRow {
  const row = database
    .prepare(
      `SELECT * FROM projects
        WHERE id = ? AND trashed_at IS NULL
          ${options.includeArchived ? "" : "AND archived_at IS NULL"}`,
    )
    .get(projectId) as ProjectRow | undefined;
  if (!row) throw new ResourceNotFoundError("Project not found.");
  return row;
}

function toProject(database: Database, row: ProjectRow): Project {
  const teamIds = database.prepare("SELECT team_id AS id FROM project_teams WHERE project_id = ? ORDER BY team_id").all(row.id).map((item) => String((item as { id: string }).id));
  const memberIds = database.prepare("SELECT user_id AS id FROM project_members WHERE project_id = ? ORDER BY user_id").all(row.id).map((item) => String((item as { id: string }).id));
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    teamId: row.team_id,
    name: row.name,
    slug: row.slug,
    summary: row.summary,
    description: row.description,
    status: row.status,
    priority: row.priority,
    leadId: row.lead_id,
    color: row.color,
    icon: row.icon,
    startDate: row.start_date,
    targetDate: row.target_date,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    teamIds,
    memberIds,
  };
}

function uniqueProjectSlug(database: Database, workspaceId: string, name: string): string {
  const base = slugify(name);
  let value = base;
  let suffix = 2;
  while (database.prepare("SELECT 1 FROM projects WHERE workspace_id = ? AND slug = ?").get(workspaceId, value)) {
    value = `${base.slice(0, 42)}-${suffix++}`;
  }
  return value;
}

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Invalid project date.");

const projectChangesSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    summary: z.string().max(1_000).optional(),
    description: z.string().max(100_000).optional(),
    status: z.enum(["planned", "started", "paused", "completed", "canceled"]).optional(),
    priority: z.number().int().min(0).max(4).optional(),
    leadId: z.string().min(1).nullable().optional(),
    color: z.string().min(1).max(32).optional(),
    icon: z.string().min(1).max(16).optional(),
    startDate: dateOnlySchema.nullable().optional(),
    targetDate: dateOnlySchema.nullable().optional(),
    teamIds: z.array(z.string().min(1)).min(1).max(20).optional(),
    memberIds: z.array(z.string().min(1)).max(100).optional(),
  })
  .strict();

function validateTeams(database: Database, workspaceId: string, teamIds: string[]): void {
  for (const teamId of [...new Set(teamIds)]) {
    const row = database.prepare("SELECT 1 FROM teams WHERE id = ? AND workspace_id = ?").get(teamId, workspaceId);
    if (!row) throw new DomainValidationError("One or more teams are not part of this workspace.");
  }
}

function validateActiveWorkspaceUser(
  database: Database,
  workspaceId: string,
  userId: string | null | undefined,
  label: string,
): void {
  if (!userId) return;
  const member = database
    .prepare(
      "SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND status = 'active'",
    )
    .get(workspaceId, userId);
  if (!member) throw new DomainValidationError(`${label} must be an active workspace member.`);
}

function requireProjectVisibility(
  database: Database,
  workspaceId: string,
  actorId: string,
  projectId: string,
): void {
  const teamIds = database
    .prepare(
      `SELECT pt.team_id AS teamId
         FROM project_teams pt
         JOIN projects project ON project.id = pt.project_id
        WHERE pt.project_id = ? AND project.workspace_id = ?
          AND project.trashed_at IS NULL`,
    )
    .all(projectId, workspaceId) as Array<{ teamId: string }>;
  if (teamIds.length === 0) {
    const workspaceContext = requireWorkspacePermission(actorId, workspaceId, "read");
    if (workspaceContext.role === "guest") throw new ResourceNotFoundError("Project not found.");
    return;
  }
  if (
    !teamIds.some(({ teamId }) =>
      hasTeamPermission(getTeamPermissionContext(actorId, teamId), "read"),
    )
  ) {
    throw new ResourceNotFoundError("Project not found.");
  }
}

export function listArchivedProjects(workspaceId: string, actorId: string): Project[] {
  requireWorkspacePermission(actorId, workspaceId, "read");
  const database = getDatabase();
  const rows = database
    .prepare(
      `SELECT * FROM projects
        WHERE workspace_id = ? AND archived_at IS NOT NULL AND trashed_at IS NULL
        ORDER BY archived_at DESC, name COLLATE NOCASE`,
    )
    .all(workspaceId) as unknown as ProjectRow[];

  return rows.flatMap((row) => {
    try {
      requireProjectVisibility(database, workspaceId, actorId, row.id);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) return [];
      throw error;
    }
    const project = toProject(database, row);
    const visibleTeamIds = project.teamIds.filter((teamId) =>
      hasTeamPermission(getTeamPermissionContext(actorId, teamId), "read"),
    );
    return [{
      ...project,
      teamId: project.teamId && visibleTeamIds.includes(project.teamId)
        ? project.teamId
        : visibleTeamIds[0] ?? null,
      teamIds: visibleTeamIds,
    }];
  });
}

function validateProjectReferences(
  database: Database,
  workspaceId: string,
  actorId: string,
  changes: z.infer<typeof projectChangesSchema>,
): void {
  if (changes.teamIds) {
    validateTeams(database, workspaceId, changes.teamIds);
    for (const teamId of [...new Set(changes.teamIds)]) {
      const context = requireTeamPermission(actorId, teamId, "create_issue");
      if (context.workspaceId !== workspaceId) throw new ResourceNotFoundError();
    }
  }
  validateActiveWorkspaceUser(database, workspaceId, changes.leadId, "Project lead");
  for (const memberId of [...new Set(changes.memberIds ?? [])]) {
    validateActiveWorkspaceUser(database, workspaceId, memberId, "Project member");
  }
}

function validateProjectDates(
  current: Pick<ProjectRow, "start_date" | "target_date"> | null,
  changes: Pick<z.infer<typeof projectChangesSchema>, "startDate" | "targetDate">,
): void {
  const startDate = changes.startDate === undefined ? current?.start_date ?? null : changes.startDate;
  const targetDate = changes.targetDate === undefined ? current?.target_date ?? null : changes.targetDate;
  if (startDate && targetDate && targetDate < startDate) {
    throw new DomainValidationError("Project target date must be on or after its start date.");
  }
}

function createProject(workspaceId: string, actorId: string, payload: unknown): MutationResult<Project> {
  requireWorkspacePermission(actorId, workspaceId, "create_project");
  const parsed = projectChangesSchema.extend({ name: z.string().trim().min(1).max(200), teamIds: z.array(z.string().min(1)).min(1).max(20) }).safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid project data.");

  return transaction((database) => {
    validateProjectReferences(database, workspaceId, actorId, parsed.data);
    validateProjectDates(null, parsed.data);
    const id = createId("project");
    const now = new Date().toISOString();
    const slug = uniqueProjectSlug(database, workspaceId, parsed.data.name);
    const color = parsed.data.color ?? "#5e6ad2";
    database
      .prepare(
        `INSERT INTO projects(
          id, workspace_id, team_id, name, slug, summary, description, status,
          priority, lead_id, color, icon, start_date, target_date, sort_order,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        workspaceId,
        parsed.data.teamIds[0],
        parsed.data.name,
        slug,
        parsed.data.summary ?? "",
        parsed.data.description ?? "",
        parsed.data.status ?? "planned",
        parsed.data.priority ?? 0,
        parsed.data.leadId ?? actorId,
        color,
        parsed.data.icon ?? parsed.data.name.slice(0, 1).toUpperCase(),
        parsed.data.startDate ?? null,
        parsed.data.targetDate ?? null,
        Date.now(),
        now,
        now,
      );
    const insertTeam = database.prepare("INSERT INTO project_teams(project_id, team_id) VALUES (?, ?)");
    for (const teamId of [...new Set(parsed.data.teamIds)]) insertTeam.run(id, teamId);
    const insertMember = database.prepare("INSERT INTO project_members(project_id, user_id) VALUES (?, ?)");
    for (const memberId of [...new Set([actorId, ...(parsed.data.memberIds ?? [])])]) {
      insertMember.run(id, memberId);
    }
    finishMutation(database, { workspaceId, actorId, entityType: "project", entityId: id, eventType: "project.created", action: "created", metadata: { name: parsed.data.name }, createdAt: now });
    return { data: toProject(database, getProjectRow(database, id)), eventType: "project.created", resourceId: id };
  });
}

function updateProject(workspaceId: string, actorId: string, payload: unknown): MutationResult<Project> {
  requireWorkspacePermission(actorId, workspaceId, "create_project");
  const parsed = z.object({ projectId: z.string().min(1), changes: projectChangesSchema }).strict().safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid project update.");
  const row = getProjectRow(getDatabase(), parsed.data.projectId);
  if (row.workspace_id !== workspaceId) throw new ResourceNotFoundError();
  requireProjectVisibility(getDatabase(), workspaceId, actorId, row.id);

  const data = transaction((database) => {
    validateProjectReferences(database, workspaceId, actorId, parsed.data.changes);
    validateProjectDates(row, parsed.data.changes);
    const sets: string[] = [];
    const values: BindValue[] = [];
    const mapping = {
      name: "name",
      summary: "summary",
      description: "description",
      status: "status",
      priority: "priority",
      leadId: "lead_id",
      color: "color",
      icon: "icon",
      startDate: "start_date",
      targetDate: "target_date",
    } as const;
    for (const [key, column] of Object.entries(mapping) as Array<[keyof typeof mapping, string]>) {
      const value = parsed.data.changes[key];
      if (value !== undefined) {
        sets.push(`${column} = ?`);
        values.push(value as BindValue);
      }
    }
    const now = new Date().toISOString();
    if (sets.length) {
      sets.push("updated_at = ?");
      values.push(now, row.id);
      database.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    } else if (parsed.data.changes.teamIds || parsed.data.changes.memberIds) {
      database.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, row.id);
    }
    if (parsed.data.changes.teamIds) {
      database.prepare("DELETE FROM project_teams WHERE project_id = ?").run(row.id);
      const insert = database.prepare("INSERT INTO project_teams(project_id, team_id) VALUES (?, ?)");
      for (const teamId of [...new Set(parsed.data.changes.teamIds)]) insert.run(row.id, teamId);
      database.prepare("UPDATE projects SET team_id = ? WHERE id = ?").run(parsed.data.changes.teamIds[0], row.id);
    }
    if (parsed.data.changes.memberIds) {
      database.prepare("DELETE FROM project_members WHERE project_id = ?").run(row.id);
      const insert = database.prepare("INSERT INTO project_members(project_id, user_id) VALUES (?, ?)");
      for (const memberId of [...new Set(parsed.data.changes.memberIds)]) insert.run(row.id, memberId);
    }
    finishMutation(database, { workspaceId, actorId, entityType: "project", entityId: row.id, eventType: "project.updated", action: "updated", metadata: { changes: parsed.data.changes }, createdAt: now });
    return toProject(database, getProjectRow(database, row.id));
  });
  return { data, eventType: "project.updated", resourceId: row.id };
}

function setProjectArchived(
  action: "project.archive" | "project.restore",
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<Project> {
  requireWorkspacePermission(actorId, workspaceId, "create_project");
  const parsed = z.object({ projectId: z.string().min(1) }).strict().safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid project lifecycle action.");
  const restoring = action === "project.restore";
  const current = getProjectRow(getDatabase(), parsed.data.projectId, {
    includeArchived: true,
  });
  if (current.workspace_id !== workspaceId) throw new ResourceNotFoundError();
  requireProjectVisibility(getDatabase(), workspaceId, actorId, current.id);
  if (restoring && current.archived_at === null) {
    throw new DomainValidationError("Project is not archived.");
  }
  if (!restoring && current.archived_at !== null) {
    throw new DomainValidationError("Project is already archived.");
  }
  const now = new Date().toISOString();

  const data = transaction((database) => {
    database
      .prepare("UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?")
      .run(restoring ? null : now, now, current.id);
    const eventType = restoring ? "project.restored" : "project.archived";
    finishMutation(database, {
      workspaceId,
      actorId,
      entityType: "project",
      entityId: current.id,
      eventType,
      action: restoring ? "restored" : "archived",
      createdAt: now,
    });
    return toProject(
      database,
      getProjectRow(database, current.id, { includeArchived: true }),
    );
  });
  return {
    data,
    eventType: restoring ? "project.restored" : "project.archived",
    resourceId: current.id,
  };
}

const milestoneChangesBaseSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(10_000).optional(),
    targetDate: dateOnlySchema.nullable().optional(),
  })
  .strict();

const milestoneChangesSchema = milestoneChangesBaseSchema
  .refine((changes) => Object.values(changes).some((value) => value !== undefined), {
    message: "At least one milestone change is required.",
  });

function getMilestoneRow(database: Database, milestoneId: string): MilestoneRow {
  const row = database
    .prepare("SELECT * FROM project_milestones WHERE id = ?")
    .get(milestoneId) as MilestoneRow | undefined;
  if (!row) throw new ResourceNotFoundError("Milestone not found.");
  return row;
}

function toMilestone(row: MilestoneRow): ProjectMilestone {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    targetDate: row.target_date,
    position: row.position,
    createdAt: row.created_at,
  };
}

function createMilestone(workspaceId: string, actorId: string, payload: unknown): MutationResult<ProjectMilestone> {
  requireWorkspacePermission(actorId, workspaceId, "create_project");
  const parsed = milestoneChangesBaseSchema
    .extend({ projectId: z.string().min(1), name: z.string().trim().min(1).max(200) })
    .strict()
    .safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid milestone data.");
  const project = getProjectRow(getDatabase(), parsed.data.projectId);
  if (project.workspace_id !== workspaceId) throw new ResourceNotFoundError();
  requireProjectVisibility(getDatabase(), workspaceId, actorId, project.id);
  const now = new Date().toISOString();
  const id = createId("milestone");
  const data = transaction((database) => {
    const position = database.prepare("SELECT COALESCE(MAX(position), 0) + 1024 AS value FROM project_milestones WHERE project_id = ?").get(project.id) as { value: number };
    database.prepare(`INSERT INTO project_milestones(id, project_id, name, description, target_date, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, project.id, parsed.data.name, parsed.data.description ?? "", parsed.data.targetDate ?? null, position.value, now, now);
    finishMutation(database, { workspaceId, actorId, entityType: "project", entityId: project.id, eventType: "milestone.created", action: "milestone.created", metadata: { milestoneId: id, name: parsed.data.name }, createdAt: now });
    return toMilestone(getMilestoneRow(database, id));
  });
  return { data, eventType: "milestone.created", resourceId: id };
}

function updateMilestone(
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<ProjectMilestone> {
  requireWorkspacePermission(actorId, workspaceId, "create_project");
  const parsed = z
    .object({ milestoneId: z.string().min(1), changes: milestoneChangesSchema })
    .strict()
    .safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid milestone update.");
  const current = getMilestoneRow(getDatabase(), parsed.data.milestoneId);
  const project = getProjectRow(getDatabase(), current.project_id);
  if (project.workspace_id !== workspaceId) throw new ResourceNotFoundError();
  requireProjectVisibility(getDatabase(), workspaceId, actorId, project.id);
  const now = new Date().toISOString();
  const data = transaction((database) => {
    const sets: string[] = [];
    const values: BindValue[] = [];
    const mapping = { name: "name", description: "description", targetDate: "target_date" } as const;
    for (const [key, column] of Object.entries(mapping) as Array<[keyof typeof mapping, string]>) {
      const value = parsed.data.changes[key];
      if (value !== undefined) {
        sets.push(`${column} = ?`);
        values.push(value);
      }
    }
    sets.push("updated_at = ?");
    values.push(now, current.id);
    database.prepare(`UPDATE project_milestones SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    finishMutation(database, {
      workspaceId,
      actorId,
      entityType: "project",
      entityId: project.id,
      eventType: "milestone.updated",
      action: "milestone.updated",
      metadata: { milestoneId: current.id, changes: parsed.data.changes },
      createdAt: now,
    });
    return toMilestone(getMilestoneRow(database, current.id));
  });
  return { data, eventType: "milestone.updated", resourceId: current.id };
}

function deleteMilestone(
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<boolean> {
  requireWorkspacePermission(actorId, workspaceId, "create_project");
  const parsed = z.object({ milestoneId: z.string().min(1) }).strict().safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid milestone deletion.");
  const current = getMilestoneRow(getDatabase(), parsed.data.milestoneId);
  const project = getProjectRow(getDatabase(), current.project_id);
  if (project.workspace_id !== workspaceId) throw new ResourceNotFoundError();
  requireProjectVisibility(getDatabase(), workspaceId, actorId, project.id);
  const now = new Date().toISOString();
  const data = transaction((database) => {
    database.prepare("DELETE FROM project_milestones WHERE id = ?").run(current.id);
    finishMutation(database, {
      workspaceId,
      actorId,
      entityType: "project",
      entityId: project.id,
      eventType: "milestone.deleted",
      action: "milestone.deleted",
      metadata: { milestoneId: current.id, name: current.name },
      createdAt: now,
    });
    return true;
  });
  return { data, eventType: "milestone.deleted", resourceId: current.id };
}

function toProjectDependency(row: ProjectDependencyRow): ProjectDependency {
  return {
    id: row.id,
    projectId: row.project_id,
    dependsOnProjectId: row.depends_on_project_id,
    createdAt: row.created_at,
  };
}

function createProjectDependency(
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<ProjectDependency> {
  requireWorkspacePermission(actorId, workspaceId, "create_project");
  const parsed = z
    .object({ projectId: z.string().min(1), dependsOnProjectId: z.string().min(1) })
    .strict()
    .safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid project dependency.");
  if (parsed.data.projectId === parsed.data.dependsOnProjectId) {
    throw new DomainValidationError("A project cannot depend on itself.");
  }
  const project = getProjectRow(getDatabase(), parsed.data.projectId);
  const dependency = getProjectRow(getDatabase(), parsed.data.dependsOnProjectId);
  if (project.workspace_id !== workspaceId || dependency.workspace_id !== workspaceId) {
    throw new ResourceNotFoundError("Project not found.");
  }
  requireProjectVisibility(getDatabase(), workspaceId, actorId, project.id);
  requireProjectVisibility(getDatabase(), workspaceId, actorId, dependency.id);

  return transaction((database) => {
    const existing = database
      .prepare(
        `SELECT id FROM project_dependencies
          WHERE project_id = ? AND depends_on_project_id = ?`,
      )
      .get(project.id, dependency.id);
    if (existing) throw new ConflictError("This project dependency already exists.");
    const cycle = database
      .prepare(
        `WITH RECURSIVE reachable(id) AS (
           VALUES (?)
           UNION
           SELECT relation.depends_on_project_id
             FROM project_dependencies relation
             JOIN reachable ON relation.project_id = reachable.id
         )
         SELECT 1 AS found FROM reachable WHERE id = ? LIMIT 1`,
      )
      .get(dependency.id, project.id);
    if (cycle) throw new ConflictError("This project dependency would create a cycle.");

    const id = createId("pdependency");
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO project_dependencies(id, project_id, depends_on_project_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(id, project.id, dependency.id, now);
    finishMutation(database, {
      workspaceId,
      actorId,
      entityType: "project",
      entityId: project.id,
      eventType: "projectDependency.created",
      action: "dependency.created",
      metadata: { dependencyId: id, dependsOnProjectId: dependency.id },
      createdAt: now,
    });
    const row = database
      .prepare("SELECT * FROM project_dependencies WHERE id = ?")
      .get(id) as unknown as ProjectDependencyRow;
    return {
      data: toProjectDependency(row),
      eventType: "projectDependency.created",
      resourceId: id,
    };
  });
}

function deleteProjectDependency(
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<boolean> {
  requireWorkspacePermission(actorId, workspaceId, "create_project");
  const parsed = z.object({ dependencyId: z.string().min(1) }).strict().safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid project dependency deletion.");
  const relation = getDatabase()
    .prepare("SELECT * FROM project_dependencies WHERE id = ?")
    .get(parsed.data.dependencyId) as ProjectDependencyRow | undefined;
  if (!relation) throw new ResourceNotFoundError("Project dependency not found.");
  const project = getProjectRow(getDatabase(), relation.project_id);
  const dependency = getProjectRow(getDatabase(), relation.depends_on_project_id);
  if (project.workspace_id !== workspaceId || dependency.workspace_id !== workspaceId) {
    throw new ResourceNotFoundError("Project dependency not found.");
  }
  requireProjectVisibility(getDatabase(), workspaceId, actorId, project.id);
  requireProjectVisibility(getDatabase(), workspaceId, actorId, dependency.id);
  const now = new Date().toISOString();
  const data = transaction((database) => {
    database.prepare("DELETE FROM project_dependencies WHERE id = ?").run(relation.id);
    finishMutation(database, {
      workspaceId,
      actorId,
      entityType: "project",
      entityId: project.id,
      eventType: "projectDependency.deleted",
      action: "dependency.deleted",
      metadata: {
        dependencyId: relation.id,
        dependsOnProjectId: dependency.id,
      },
      createdAt: now,
    });
    return true;
  });
  return { data, eventType: "projectDependency.deleted", resourceId: relation.id };
}

function createProjectUpdate(workspaceId: string, actorId: string, payload: unknown): MutationResult<ProjectUpdate> {
  requireWorkspacePermission(actorId, workspaceId, "create_project");
  const parsed = z.object({ projectId: z.string().min(1), health: z.enum(["onTrack", "atRisk", "offTrack"]), body: z.string().trim().min(1).max(100_000) }).strict().safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid project update.");
  const project = getProjectRow(getDatabase(), parsed.data.projectId);
  if (project.workspace_id !== workspaceId) throw new ResourceNotFoundError();
  requireProjectVisibility(getDatabase(), workspaceId, actorId, project.id);
  const now = new Date().toISOString();
  const id = createId("pupdate");
  const data = transaction((database) => {
    database.prepare(`INSERT INTO project_updates(id, project_id, author_id, health, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, project.id, actorId, parsed.data.health, parsed.data.body, now, now);
    database.prepare("UPDATE projects SET health = ?, updated_at = ? WHERE id = ?").run(parsed.data.health, now, project.id);
    finishMutation(database, { workspaceId, actorId, entityType: "project", entityId: project.id, eventType: "project-update.created", action: "update.created", metadata: { projectUpdateId: id, health: parsed.data.health }, createdAt: now });
    const recipients = database
      .prepare(
        `SELECT DISTINCT user_id AS userId
           FROM (
             SELECT lead_id AS user_id FROM projects WHERE id = ?
             UNION ALL
             SELECT user_id FROM project_members WHERE project_id = ?
           )
          WHERE user_id IS NOT NULL`,
      )
      .all(project.id, project.id) as Array<{ userId: string }>;
    for (const recipient of recipients) {
      createNotification(database, {
        userId: recipient.userId,
        workspaceId,
        actorId,
        type: "project_update",
        title: `${project.name} has a new update`,
        body: parsed.data.body.slice(0, 180),
        entityType: "project",
        entityId: project.id,
        createdAt: now,
      });
    }
    return { id, projectId: project.id, authorId: actorId, health: parsed.data.health, body: parsed.data.body, createdAt: now };
  });
  return { data, eventType: "project-update.created", resourceId: id };
}

function toCycle(row: CycleRow): Cycle {
  return { id: row.id, teamId: row.team_id, number: row.number, name: row.name, description: row.description, startDate: row.start_date, endDate: row.end_date, status: row.status, createdAt: row.created_at };
}

const cycleChangesSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  startDate: dateOnlySchema.optional(),
  endDate: dateOnlySchema.optional(),
  status: z.enum(["upcoming", "active", "completed"]).optional(),
  capacity: z.number().int().min(0).nullable().optional(),
}).strict();

function validateCycleSchedule(
  database: Database,
  teamId: string,
  schedule: Pick<Cycle, "startDate" | "endDate" | "status">,
  excludeCycleId?: string,
): void {
  if (schedule.endDate <= schedule.startDate) {
    throw new DomainValidationError("Cycle end date must be after its start date.");
  }

  const exclusion = excludeCycleId ? "AND id <> ?" : "";
  const overlap = database
    .prepare(
      `SELECT id FROM cycles
        WHERE team_id = ? AND archived_at IS NULL
          AND start_date <= ? AND end_date >= ?
          ${exclusion}
        LIMIT 1`,
    )
    .get(
      teamId,
      schedule.endDate,
      schedule.startDate,
      ...(excludeCycleId ? [excludeCycleId] : []),
    );
  if (overlap) {
    throw new ConflictError("Cycle date range overlaps an existing cycle.");
  }

  if (schedule.status === "active") {
    const active = database
      .prepare(
        `SELECT id FROM cycles
          WHERE team_id = ? AND status = 'active' AND archived_at IS NULL
            ${exclusion}
          LIMIT 1`,
      )
      .get(teamId, ...(excludeCycleId ? [excludeCycleId] : []));
    if (active) throw new ConflictError("Team already has an active cycle.");
  }
}

function handleCycleAction(action: string, workspaceId: string, actorId: string, payload: unknown): MutationResult<Cycle> {
  if (action === "cycle.create") {
    const parsed = cycleChangesSchema.extend({ teamId: z.string().min(1), number: z.number().int().positive(), name: z.string().trim().min(1).max(200), startDate: dateOnlySchema, endDate: dateOnlySchema }).safeParse(payload);
    if (!parsed.success) throw new DomainValidationError("Invalid cycle data.");
    const context = requireTeamPermission(actorId, parsed.data.teamId, "manage");
    if (context.workspaceId !== workspaceId) throw new ResourceNotFoundError();
    const now = new Date().toISOString();
    const id = createId("cycle");
    const data = transaction((database) => {
      validateCycleSchedule(database, parsed.data.teamId, {
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        status: parsed.data.status ?? "upcoming",
      });
      database.prepare(`INSERT INTO cycles(id, team_id, number, name, description, start_date, end_date, status, capacity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, parsed.data.teamId, parsed.data.number, parsed.data.name, parsed.data.description ?? "", parsed.data.startDate, parsed.data.endDate, parsed.data.status ?? "upcoming", parsed.data.capacity ?? null, now, now);
      finishMutation(database, { workspaceId, actorId, entityType: "cycle", entityId: id, eventType: "cycle.created", action: "created", createdAt: now });
      return toCycle(database.prepare("SELECT * FROM cycles WHERE id = ?").get(id) as unknown as CycleRow);
    });
    return { data, eventType: "cycle.created", resourceId: id };
  }

  const parsed = z.object({ cycleId: z.string().min(1), changes: cycleChangesSchema }).strict().safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid cycle update.");
  const current = getDatabase().prepare(`SELECT c.*, t.workspace_id FROM cycles c JOIN teams t ON t.id = c.team_id WHERE c.id = ?`).get(parsed.data.cycleId) as (CycleRow & { workspace_id: string }) | undefined;
  if (!current || current.workspace_id !== workspaceId) throw new ResourceNotFoundError("Cycle not found.");
  requireTeamPermission(actorId, current.team_id, "manage");
  const data = transaction((database) => {
    validateCycleSchedule(database, current.team_id, {
      startDate: parsed.data.changes.startDate ?? current.start_date,
      endDate: parsed.data.changes.endDate ?? current.end_date,
      status: parsed.data.changes.status ?? current.status,
    }, current.id);
    const sets: string[] = [];
    const values: BindValue[] = [];
    const mapping = { name: "name", description: "description", startDate: "start_date", endDate: "end_date", status: "status", capacity: "capacity" } as const;
    for (const [key, column] of Object.entries(mapping) as Array<[keyof typeof mapping, string]>) {
      const value = parsed.data.changes[key];
      if (value !== undefined) { sets.push(`${column} = ?`); values.push(value as BindValue); }
    }
    const now = new Date().toISOString();
    if (sets.length) { sets.push("updated_at = ?"); values.push(now, current.id); database.prepare(`UPDATE cycles SET ${sets.join(", ")} WHERE id = ?`).run(...values); }
    finishMutation(database, { workspaceId, actorId, entityType: "cycle", entityId: current.id, eventType: "cycle.updated", action: "updated", metadata: { changes: parsed.data.changes }, createdAt: now });
    return toCycle(database.prepare("SELECT * FROM cycles WHERE id = ?").get(current.id) as unknown as CycleRow);
  });
  return { data, eventType: "cycle.updated", resourceId: current.id };
}

function getInitiativeRow(database: Database, initiativeId: string): InitiativeRow {
  const row = database.prepare("SELECT * FROM initiatives WHERE id = ?").get(initiativeId) as InitiativeRow | undefined;
  if (!row) throw new ResourceNotFoundError("Initiative not found.");
  return row;
}

function toInitiative(database: Database, row: InitiativeRow): Initiative {
  const projectIds = database.prepare("SELECT project_id AS id FROM initiative_projects WHERE initiative_id = ? ORDER BY position").all(row.id).map((item) => String((item as { id: string }).id));
  return { id: row.id, workspaceId: row.workspace_id, parentId: row.parent_id, name: row.name, summary: row.summary, description: row.description, status: row.status, priority: row.priority, ownerId: row.owner_id, targetDate: row.target_date, color: row.color, createdAt: row.created_at, projectIds };
}

const initiativeChangesSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(), summary: z.string().max(1_000).optional(), description: z.string().max(100_000).optional(), status: z.enum(["planned", "active", "completed", "paused"]).optional(), priority: z.number().int().min(0).max(4).optional(), ownerId: z.string().min(1).nullable().optional(), targetDate: z.string().max(32).nullable().optional(), color: z.string().min(1).max(32).optional(), parentId: z.string().min(1).nullable().optional(), projectIds: z.array(z.string().min(1)).max(100).optional(),
}).strict();

function validateInitiativeChanges(
  database: Database,
  workspaceId: string,
  actorId: string,
  changes: z.infer<typeof initiativeChangesSchema>,
  initiativeId?: string,
): void {
  validateActiveWorkspaceUser(database, workspaceId, changes.ownerId, "Initiative owner");
  for (const projectId of [...new Set(changes.projectIds ?? [])]) {
    const project = getProjectRow(database, projectId);
    if (project.workspace_id !== workspaceId) throw new ResourceNotFoundError("Project not found.");
    requireProjectVisibility(database, workspaceId, actorId, projectId);
  }
  if (changes.parentId) {
    const visited = new Set(initiativeId ? [initiativeId] : []);
    let currentId: string | null = changes.parentId;
    while (currentId) {
      if (visited.has(currentId)) {
        throw new DomainValidationError("Initiative hierarchy would create a cycle.");
      }
      visited.add(currentId);
      const current = database
        .prepare("SELECT workspace_id AS workspaceId, parent_id AS parentId FROM initiatives WHERE id = ?")
        .get(currentId) as { workspaceId: string; parentId: string | null } | undefined;
      if (!current || current.workspaceId !== workspaceId) {
        throw new ResourceNotFoundError("Parent initiative not found.");
      }
      currentId = current.parentId;
    }
  }
}

function handleInitiativeAction(action: string, workspaceId: string, actorId: string, payload: unknown): MutationResult<Initiative> {
  requireWorkspacePermission(actorId, workspaceId, "create_project");
  if (action === "initiative.create") {
    const parsed = initiativeChangesSchema.extend({ name: z.string().trim().min(1).max(200) }).safeParse(payload);
    if (!parsed.success) throw new DomainValidationError("Invalid initiative data.");
    const now = new Date().toISOString();
    const id = createId("initiative");
    const data = transaction((database) => {
      validateInitiativeChanges(database, workspaceId, actorId, parsed.data);
      database.prepare(`INSERT INTO initiatives(id, workspace_id, parent_id, name, summary, description, status, priority, owner_id, target_date, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, workspaceId, parsed.data.parentId ?? null, parsed.data.name, parsed.data.summary ?? "", parsed.data.description ?? "", parsed.data.status ?? "planned", parsed.data.priority ?? 0, parsed.data.ownerId ?? actorId, parsed.data.targetDate ?? null, parsed.data.color ?? "#5e6ad2", Date.now(), now, now);
      const insert = database.prepare("INSERT INTO initiative_projects(initiative_id, project_id, position) VALUES (?, ?, ?)");
      for (const [index, projectId] of (parsed.data.projectIds ?? []).entries()) insert.run(id, projectId, index * 1024);
      finishMutation(database, { workspaceId, actorId, entityType: "initiative", entityId: id, eventType: "initiative.created", action: "created", createdAt: now });
      return toInitiative(database, getInitiativeRow(database, id));
    });
    return { data, eventType: "initiative.created", resourceId: id };
  }
  const parsed = z.object({ initiativeId: z.string().min(1), changes: initiativeChangesSchema }).strict().safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid initiative update.");
  const row = getInitiativeRow(getDatabase(), parsed.data.initiativeId);
  if (row.workspace_id !== workspaceId) throw new ResourceNotFoundError();
  const data = transaction((database) => {
    validateInitiativeChanges(database, workspaceId, actorId, parsed.data.changes, row.id);
    const sets: string[] = [];
    const values: BindValue[] = [];
    const mapping = { name: "name", summary: "summary", description: "description", status: "status", priority: "priority", ownerId: "owner_id", targetDate: "target_date", color: "color", parentId: "parent_id" } as const;
    for (const [key, column] of Object.entries(mapping) as Array<[keyof typeof mapping, string]>) { const value = parsed.data.changes[key]; if (value !== undefined) { sets.push(`${column} = ?`); values.push(value as BindValue); } }
    const now = new Date().toISOString();
    if (sets.length) { sets.push("updated_at = ?"); values.push(now, row.id); database.prepare(`UPDATE initiatives SET ${sets.join(", ")} WHERE id = ?`).run(...values); }
    if (parsed.data.changes.projectIds) { database.prepare("DELETE FROM initiative_projects WHERE initiative_id = ?").run(row.id); const insert = database.prepare("INSERT INTO initiative_projects(initiative_id, project_id, position) VALUES (?, ?, ?)"); for (const [index, projectId] of parsed.data.changes.projectIds.entries()) insert.run(row.id, projectId, index * 1024); }
    finishMutation(database, { workspaceId, actorId, entityType: "initiative", entityId: row.id, eventType: "initiative.updated", action: "updated", metadata: { changes: parsed.data.changes }, createdAt: now });
    return toInitiative(database, getInitiativeRow(database, row.id));
  });
  return { data, eventType: "initiative.updated", resourceId: row.id };
}

export function executePlanningAction(action: string, workspaceId: string, actorId: string, payload: unknown): MutationResult | null {
  if (action === "project.create") return createProject(workspaceId, actorId, payload);
  if (action === "project.update") return updateProject(workspaceId, actorId, payload);
  if (action === "project.archive" || action === "project.restore") {
    return setProjectArchived(action, workspaceId, actorId, payload);
  }
  if (action === "milestone.create") return createMilestone(workspaceId, actorId, payload);
  if (action === "milestone.update") return updateMilestone(workspaceId, actorId, payload);
  if (action === "milestone.delete") return deleteMilestone(workspaceId, actorId, payload);
  if (action === "projectDependency.create") {
    return createProjectDependency(workspaceId, actorId, payload);
  }
  if (action === "projectDependency.delete") {
    return deleteProjectDependency(workspaceId, actorId, payload);
  }
  if (action === "projectUpdate.create") return createProjectUpdate(workspaceId, actorId, payload);
  if (action === "cycle.create" || action === "cycle.update") return handleCycleAction(action, workspaceId, actorId, payload);
  if (action === "initiative.create" || action === "initiative.update") return handleInitiativeAction(action, workspaceId, actorId, payload);
  return null;
}
