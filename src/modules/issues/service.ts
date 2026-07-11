import "server-only";

import type { Database } from "@/lib/db";
import { getDatabase, transaction, type BindValue } from "@/lib/db";
import type { Comment, Issue, IssueRelation, Reaction, WorkflowState } from "@/lib/domain";
import {
  getTeamPermissionContext,
  hasTeamPermission,
  PermissionError,
  requireTeamPermission,
} from "@/lib/auth";
import { createId } from "@/lib/security";
import { getIssueStatusTransitionChanges } from "@/modules/issues/logic";
import {
  ConflictError,
  createNotification,
  DomainValidationError,
  finishMutation,
  type MutationResult,
  ResourceNotFoundError,
} from "@/modules/shared/mutation";
import { z } from "zod";

interface IssueRow {
  id: string;
  workspace_id: string;
  team_id: string;
  identifier: string;
  number: number;
  title: string;
  description: string;
  status_id: string;
  priority: Issue["priority"];
  assignee_id: string | null;
  creator_id: string;
  project_id: string | null;
  milestone_id: string | null;
  cycle_id: string | null;
  parent_id: string | null;
  estimate: number | null;
  due_date: string | null;
  sort_order: number;
  triage_status: Issue["triageStatus"];
  snoozed_until: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  archived_at: string | null;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CommentRow {
  id: string;
  issue_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  resolved_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  workspace_id: string;
  team_id: string;
  identifier: string;
}

interface ReactionRow {
  id: string;
  comment_id: string;
  user_id: string;
  emoji: string;
}

interface IssueRelationRow {
  id: string;
  issue_id: string;
  related_issue_id: string;
  type: IssueRelation["type"];
  created_at: string;
}

const nullableId = z.string().min(1).nullable();
const issuePrioritySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
const issueChangesSchema = z
  .object({
    teamId: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(100_000).optional(),
    statusId: z.string().min(1).optional(),
    priority: issuePrioritySchema.optional(),
    assigneeId: nullableId.optional(),
    projectId: nullableId.optional(),
    milestoneId: nullableId.optional(),
    cycleId: nullableId.optional(),
    parentId: nullableId.optional(),
    estimate: z.number().int().min(0).max(1_000).nullable().optional(),
    dueDate: z.string().max(32).nullable().optional(),
    sortOrder: z.number().finite().optional(),
    triageStatus: z.enum(["pending", "accepted", "declined", "snoozed"]).nullable().optional(),
    snoozedUntil: z.string().max(40).nullable().optional(),
    labelIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .strict();

const createIssueSchema = issueChangesSchema.extend({
  teamId: z.string().min(1),
  title: z.string().trim().min(1).max(500),
  statusId: z.string().min(1).optional(),
  subIssues: z
    .array(
      z
        .object({
          title: z.string().trim().min(1).max(500),
          description: z.string().max(100_000).default(""),
        })
        .strict(),
    )
    .max(100)
    .optional(),
});

const commentBodySchema = z.string().trim().min(1).max(100_000);
const commentUpdateSchema = z.union([
  z.object({ commentId: z.string().min(1), body: commentBodySchema }).strict(),
  z
    .object({
      commentId: z.string().min(1),
      changes: z.object({ body: commentBodySchema }).strict(),
    })
    .strict(),
]);
const issueRelationTypeSchema = z.enum(["related", "blocks", "duplicate"]);
const issueRelationCreateSchema = z
  .object({
    issueId: z.string().min(1),
    relatedIssueId: z.string().min(1),
    type: issueRelationTypeSchema,
  })
  .strict();
const issueRelationDeleteSchema = z.union([
  z.object({ relationId: z.string().min(1) }).strict(),
  z
    .object({
      issueId: z.string().min(1),
      relatedIssueId: z.string().min(1),
      type: issueRelationTypeSchema,
    })
    .strict(),
]);

function rowToIssue(database: Database, row: IssueRow): Issue {
  const labelIds = database
    .prepare("SELECT label_id AS id FROM issue_labels WHERE issue_id = ? ORDER BY label_id")
    .all(row.id)
    .map((item) => String((item as { id: string }).id));
  const subscriberIds = database
    .prepare("SELECT user_id AS id FROM issue_subscribers WHERE issue_id = ? ORDER BY user_id")
    .all(row.id)
    .map((item) => String((item as { id: string }).id));

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    teamId: row.team_id,
    identifier: row.identifier,
    number: row.number,
    title: row.title,
    description: row.description,
    statusId: row.status_id,
    priority: row.priority,
    assigneeId: row.assignee_id,
    creatorId: row.creator_id,
    projectId: row.project_id,
    milestoneId: row.milestone_id,
    cycleId: row.cycle_id,
    parentId: row.parent_id,
    estimate: row.estimate,
    dueDate: row.due_date,
    sortOrder: row.sort_order,
    triageStatus: row.triage_status,
    snoozedUntil: row.snoozed_until,
    completedAt: row.completed_at,
    canceledAt: row.canceled_at,
    archivedAt: row.archived_at,
    trashedAt: row.trashed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    labelIds,
    subscriberIds,
  };
}

function getIssueRow(database: Database, issueId: string): IssueRow {
  const row = database.prepare("SELECT * FROM issues WHERE id = ?").get(issueId) as IssueRow | undefined;
  if (!row) throw new ResourceNotFoundError("Issue not found.");
  return row;
}

function getIssue(database: Database, issueId: string): Issue {
  return rowToIssue(database, getIssueRow(database, issueId));
}

function getCommentRow(database: Database, commentId: string): CommentRow {
  const row = database
    .prepare(
      `SELECT c.id, c.issue_id, c.author_id, c.parent_id, c.body, c.resolved_at,
              c.edited_at, c.deleted_at, c.created_at, c.updated_at,
              i.workspace_id, i.team_id, i.identifier
         FROM comments c
         JOIN issues i ON i.id = c.issue_id
        WHERE c.id = ?`,
    )
    .get(commentId) as CommentRow | undefined;
  if (!row) throw new ResourceNotFoundError("Comment not found.");
  return row;
}

function rowToComment(row: CommentRow): Comment {
  return {
    id: row.id,
    issueId: row.issue_id,
    authorId: row.author_id,
    parentId: row.parent_id,
    body: row.body,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getIssueRelationRow(database: Database, relationId: string): IssueRelationRow {
  const row = database
    .prepare(
      `SELECT id, issue_id, related_issue_id, type, created_at
         FROM issue_relations
        WHERE id = ?`,
    )
    .get(relationId) as IssueRelationRow | undefined;
  if (!row) throw new ResourceNotFoundError("Issue relation not found.");
  return row;
}

function rowToIssueRelation(row: IssueRelationRow): IssueRelation {
  return {
    id: row.id,
    issueId: row.issue_id,
    relatedIssueId: row.related_issue_id,
    type: row.type,
    createdAt: row.created_at,
  };
}

function assertCommentIsAvailable(row: CommentRow, workspaceId: string): void {
  if (row.workspace_id !== workspaceId || row.deleted_at) {
    throw new ResourceNotFoundError("Comment not found.");
  }
}

function assertCanModifyComment(row: CommentRow, actorId: string): void {
  const context = requireTeamPermission(actorId, row.team_id, "edit_issue");
  if (row.author_id !== actorId && context.role !== "admin" && context.teamRole !== "lead") {
    throw new PermissionError("Only the comment author or a team administrator can modify it.");
  }
}

function wouldCreateDirectedRelationCycle(
  database: Database,
  issueId: string,
  relatedIssueId: string,
  type: "blocks" | "duplicate",
): boolean {
  const cycle = database
    .prepare(
      `WITH RECURSIVE reachable(id) AS (
         VALUES (?)
         UNION
         SELECT relation.related_issue_id
           FROM issue_relations relation
           JOIN reachable ON relation.issue_id = reachable.id
          WHERE relation.type = ?
       )
       SELECT 1 AS found FROM reachable WHERE id = ? LIMIT 1`,
    )
    .get(relatedIssueId, type, issueId);
  return Boolean(cycle);
}

function findRelationBySelector(
  database: Database,
  selector: z.infer<typeof issueRelationDeleteSchema>,
): IssueRelationRow {
  if ("relationId" in selector) return getIssueRelationRow(database, selector.relationId);

  const row = (selector.type === "related"
    ? database
        .prepare(
          `SELECT id, issue_id, related_issue_id, type, created_at
             FROM issue_relations
            WHERE type = 'related'
              AND ((issue_id = ? AND related_issue_id = ?)
                OR (issue_id = ? AND related_issue_id = ?))
            LIMIT 1`,
        )
        .get(
          selector.issueId,
          selector.relatedIssueId,
          selector.relatedIssueId,
          selector.issueId,
        )
    : database
        .prepare(
          `SELECT id, issue_id, related_issue_id, type, created_at
             FROM issue_relations
            WHERE issue_id = ? AND related_issue_id = ? AND type = ?`,
        )
        .get(selector.issueId, selector.relatedIssueId, selector.type)) as
    | IssueRelationRow
    | undefined;
  if (!row) throw new ResourceNotFoundError("Issue relation not found.");
  return row;
}

function validateIssueReferences(
  database: Database,
  workspaceId: string,
  teamId: string,
  input: z.infer<typeof issueChangesSchema>,
  issueId?: string,
): void {
  if (input.statusId) {
    const status = database
      .prepare("SELECT id FROM workflow_states WHERE id = ? AND team_id = ?")
      .get(input.statusId, teamId);
    if (!status) throw new DomainValidationError("Status does not belong to the issue team.");
  }
  if (input.assigneeId) {
    const member = database
      .prepare(
        `SELECT 1 FROM workspace_members
          WHERE workspace_id = ? AND user_id = ? AND status = 'active'`,
      )
      .get(workspaceId, input.assigneeId);
    if (!member) throw new DomainValidationError("Assignee is not an active workspace member.");
  }
  if (input.projectId) {
    const project = database
      .prepare("SELECT id FROM projects WHERE id = ? AND workspace_id = ? AND trashed_at IS NULL")
      .get(input.projectId, workspaceId);
    if (!project) throw new DomainValidationError("Project is not available in this workspace.");
  }
  if (input.milestoneId) {
    const effectiveProjectId =
      input.projectId !== undefined
        ? input.projectId
        : issueId
          ? (database.prepare("SELECT project_id AS projectId FROM issues WHERE id = ?").get(issueId) as
              | { projectId: string | null }
              | undefined)?.projectId ?? null
          : null;
    if (!effectiveProjectId) {
      throw new DomainValidationError("A milestone requires a project.");
    }
    const milestone = database
      .prepare(
        `SELECT 1
           FROM project_milestones milestone
           JOIN projects project ON project.id = milestone.project_id
          WHERE milestone.id = ? AND milestone.project_id = ?
            AND project.workspace_id = ? AND project.trashed_at IS NULL`,
      )
      .get(input.milestoneId, effectiveProjectId, workspaceId);
    if (!milestone) throw new DomainValidationError("Milestone does not belong to the selected project.");
  }
  if (input.cycleId) {
    const cycle = database
      .prepare("SELECT id FROM cycles WHERE id = ? AND team_id = ? AND archived_at IS NULL")
      .get(input.cycleId, teamId);
    if (!cycle) throw new DomainValidationError("Cycle does not belong to the issue team.");
  }
  if (input.parentId) {
    const parent = database
      .prepare("SELECT id, workspace_id FROM issues WHERE id = ? AND trashed_at IS NULL")
      .get(input.parentId) as { id: string; workspace_id: string } | undefined;
    if (!parent || parent.workspace_id !== workspaceId) {
      throw new DomainValidationError("Parent issue is not available in this workspace.");
    }
    const visited = new Set<string>(issueId ? [issueId] : []);
    let currentId: string | null = input.parentId;
    while (currentId) {
      if (visited.has(currentId)) throw new ConflictError("Issue parent relationship would create a cycle.");
      visited.add(currentId);
      const current = database.prepare("SELECT parent_id FROM issues WHERE id = ?").get(currentId) as
        | { parent_id: string | null }
        | undefined;
      currentId = current?.parent_id ?? null;
    }
  }
  if (input.labelIds) {
    const uniqueIds = [...new Set(input.labelIds)];
    for (const labelId of uniqueIds) {
      const label = database
        .prepare(
          `SELECT id FROM labels
            WHERE id = ? AND workspace_id = ? AND (team_id IS NULL OR team_id = ?)`,
        )
        .get(labelId, workspaceId, teamId);
      if (!label) throw new DomainValidationError("One or more labels are not available to this team.");
    }
  }
}

function statusTimestamps(
  database: Database,
  statusId: string,
  now: string,
): { completedAt: string | null; canceledAt: string | null } {
  const status = database.prepare("SELECT type FROM workflow_states WHERE id = ?").get(statusId) as
    | { type: string }
    | undefined;
  return {
    completedAt: status?.type === "completed" ? now : null,
    canceledAt: status?.type === "canceled" ? now : null,
  };
}

function mentionedWorkspaceUsers(
  database: Database,
  workspaceId: string,
  body: string,
): string[] {
  const tokens = new Set(
    [...body.matchAll(/@([a-zA-Z0-9][a-zA-Z0-9._+-]*(?:@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})?)/g)]
      .map((match) => match[1]?.toLocaleLowerCase())
      .filter((token): token is string => Boolean(token)),
  );
  if (tokens.size === 0) return [];
  const members = database
    .prepare(
      `SELECT u.id, u.name, u.email
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = ? AND wm.status = 'active' AND u.disabled_at IS NULL`,
    )
    .all(workspaceId) as Array<{ id: string; name: string; email: string }>;
  return members
    .filter((member) => {
      const email = member.email.toLocaleLowerCase();
      const emailPrefix = email.split("@")[0] ?? email;
      const firstName = member.name.trim().split(/\s+/u)[0]?.toLocaleLowerCase() ?? "";
      return tokens.has(email) || tokens.has(emailPrefix) || (firstName.length > 1 && tokens.has(firstName));
    })
    .map((member) => member.id);
}

function applyIssueChanges(
  database: Database,
  issue: IssueRow,
  changes: z.infer<typeof issueChangesSchema>,
  actorId: string,
  now: string,
): Issue {
  const targetTeamId = changes.teamId ?? issue.team_id;
  const movingTeams = targetTeamId !== issue.team_id;
  const teamNormalizedChanges: z.infer<typeof issueChangesSchema> = movingTeams
    ? {
        ...changes,
        statusId:
          changes.statusId ??
          (database
            .prepare(
              `SELECT id FROM workflow_states
                WHERE team_id = ?
                ORDER BY is_default DESC,
                  CASE type WHEN 'unstarted' THEN 0 WHEN 'backlog' THEN 1 ELSE 2 END,
                  position
                LIMIT 1`,
            )
            .get(targetTeamId) as { id: string } | undefined)?.id,
        cycleId: changes.cycleId === undefined ? null : changes.cycleId,
      }
    : changes;
  const targetStatus = teamNormalizedChanges.statusId
    ? database
        .prepare("SELECT id, type FROM workflow_states WHERE id = ?")
        .get(teamNormalizedChanges.statusId) as
        | { id: string; type: WorkflowState["type"] }
        | undefined
    : undefined;
  const currentStatus = targetStatus
    ? database
        .prepare("SELECT type FROM workflow_states WHERE id = ?")
        .get(issue.status_id) as { type: WorkflowState["type"] } | undefined
    : undefined;
  const statusTransition = targetStatus
    ? getIssueStatusTransitionChanges(
        { triageStatus: issue.triage_status },
        currentStatus,
        targetStatus,
      )
    : undefined;
  const normalizedChanges: z.infer<typeof issueChangesSchema> = {
    ...teamNormalizedChanges,
    ...(teamNormalizedChanges.triageStatus === undefined && statusTransition?.triageStatus !== undefined
      ? { triageStatus: statusTransition.triageStatus }
      : {}),
    ...(teamNormalizedChanges.snoozedUntil === undefined && statusTransition?.snoozedUntil !== undefined
      ? { snoozedUntil: statusTransition.snoozedUntil }
      : {}),
  };
  if (movingTeams && !normalizedChanges.statusId) {
    throw new DomainValidationError("Target team does not have a workflow state.");
  }
  validateIssueReferences(database, issue.workspace_id, targetTeamId, normalizedChanges, issue.id);
  const sets: string[] = [];
  const values: BindValue[] = [];
  const scalarMapping = {
    title: "title",
    description: "description",
    statusId: "status_id",
    priority: "priority",
    assigneeId: "assignee_id",
    projectId: "project_id",
    milestoneId: "milestone_id",
    cycleId: "cycle_id",
    parentId: "parent_id",
    estimate: "estimate",
    dueDate: "due_date",
    sortOrder: "sort_order",
    triageStatus: "triage_status",
    snoozedUntil: "snoozed_until",
  } as const;

  for (const [key, column] of Object.entries(scalarMapping) as Array<
    [keyof typeof scalarMapping, string]
  >) {
    if (normalizedChanges[key] !== undefined) {
      sets.push(`${column} = ?`);
      values.push(normalizedChanges[key] as BindValue);
    }
  }

  if (movingTeams) {
    const identity = database
      .prepare(
        `UPDATE teams
            SET next_issue_number = next_issue_number + 1, updated_at = ?
          WHERE id = ? AND workspace_id = ?
          RETURNING key, next_issue_number - 1 AS issueNumber`,
      )
      .get(now, targetTeamId, issue.workspace_id) as
      | { key: string; issueNumber: number }
      | undefined;
    if (!identity) throw new ResourceNotFoundError("Target team not found.");
    const identifier = `${identity.key.toUpperCase()}-${identity.issueNumber}`;
    sets.push("team_id = ?", "identifier = ?", "number = ?");
    values.push(targetTeamId, identifier, identity.issueNumber);
    database
      .prepare(
        `INSERT OR IGNORE INTO issue_identifier_aliases(
          id, workspace_id, issue_id, identifier, is_current, created_at
        ) VALUES (?, ?, ?, ?, 0, ?)`,
      )
      .run(createId("alias"), issue.workspace_id, issue.id, issue.identifier, issue.created_at);
    database
      .prepare("UPDATE issue_identifier_aliases SET is_current = 0 WHERE issue_id = ?")
      .run(issue.id);
    database
      .prepare(
        `INSERT INTO issue_identifier_aliases(
          id, workspace_id, issue_id, identifier, is_current, created_at
        ) VALUES (?, ?, ?, ?, 1, ?)`,
      )
      .run(createId("alias"), issue.workspace_id, issue.id, identifier, now);
  }

  if (normalizedChanges.statusId) {
    const timestamps = statusTimestamps(database, normalizedChanges.statusId, now);
    sets.push("completed_at = ?", "canceled_at = ?");
    values.push(timestamps.completedAt, timestamps.canceledAt);
  }
  if (normalizedChanges.projectId !== undefined && normalizedChanges.milestoneId === undefined) {
    sets.push("milestone_id = ?");
    values.push(null);
  }
  if (sets.length > 0) {
    sets.push("updated_at = ?", "version = version + 1");
    values.push(now, issue.id);
    database.prepare(`UPDATE issues SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  if (normalizedChanges.labelIds) {
    database.prepare("DELETE FROM issue_labels WHERE issue_id = ?").run(issue.id);
    const insert = database.prepare("INSERT INTO issue_labels(issue_id, label_id) VALUES (?, ?)");
    for (const labelId of [...new Set(normalizedChanges.labelIds)]) insert.run(issue.id, labelId);
  } else if (movingTeams) {
    database
      .prepare(
        `DELETE FROM issue_labels
          WHERE issue_id = ? AND label_id IN (
            SELECT id FROM labels WHERE team_id IS NOT NULL AND team_id <> ?
          )`,
      )
      .run(issue.id, targetTeamId);
  }

  const next = getIssue(database, issue.id);
  finishMutation(database, {
    workspaceId: issue.workspace_id,
    actorId,
    entityType: "issue",
    entityId: issue.id,
    eventType: "issue.updated",
    action: "updated",
    metadata: { changes: normalizedChanges, previousTeamId: movingTeams ? issue.team_id : undefined },
    createdAt: now,
  });

  if (normalizedChanges.assigneeId && normalizedChanges.assigneeId !== issue.assignee_id) {
    database
      .prepare(
        "INSERT OR IGNORE INTO issue_subscribers(issue_id, user_id, created_at) VALUES (?, ?, ?)",
      )
      .run(issue.id, normalizedChanges.assigneeId, now);
    createNotification(database, {
      userId: normalizedChanges.assigneeId,
      workspaceId: issue.workspace_id,
      actorId,
      type: "assignment",
      title: `${next.identifier} assigned to you`,
      body: next.title,
      entityType: "issue",
      entityId: issue.id,
      createdAt: now,
    });
  }
  const subscriberFields = [
    "statusId",
    "priority",
    "assigneeId",
    "projectId",
    "milestoneId",
    "cycleId",
    "parentId",
    "estimate",
    "dueDate",
    "triageStatus",
  ] as const;
  const changedSubscriberFields: string[] = subscriberFields.filter(
    (field) => normalizedChanges[field] !== undefined,
  );
  if (movingTeams) changedSubscriberFields.unshift("teamId");
  if (changedSubscriberFields.length > 0) {
    const subscribers = database
      .prepare("SELECT user_id AS userId FROM issue_subscribers WHERE issue_id = ?")
      .all(issue.id) as Array<{ userId: string }>;
    for (const subscriber of subscribers) {
      if (normalizedChanges.assigneeId && subscriber.userId === normalizedChanges.assigneeId) continue;
      createNotification(database, {
        userId: subscriber.userId,
        workspaceId: issue.workspace_id,
        actorId,
        type: "issue_update",
        title: `${next.identifier} updated`,
        body: `${next.title} · ${changedSubscriberFields.join(", ")}`,
        entityType: "issue",
        entityId: issue.id,
        createdAt: now,
      });
    }
  }
  return getIssue(database, issue.id);
}

interface InsertIssueInput {
  workspaceId: string;
  teamId: string;
  actorId: string;
  title: string;
  description: string;
  statusId?: string;
  priority?: Issue["priority"];
  assigneeId?: string | null;
  projectId?: string | null;
  milestoneId?: string | null;
  cycleId?: string | null;
  parentId?: string | null;
  estimate?: number | null;
  dueDate?: string | null;
  triageStatus?: Issue["triageStatus"];
  snoozedUntil?: string | null;
  labelIds?: string[];
  metadata?: Record<string, unknown>;
  notifyAssignee?: boolean;
  now: string;
}

function insertCreatedIssue(database: Database, input: InsertIssueInput): Issue {
  const team = database
    .prepare(
      `UPDATE teams
          SET next_issue_number = next_issue_number + 1, updated_at = ?
        WHERE id = ? AND workspace_id = ?
        RETURNING key, next_issue_number - 1 AS issue_number`,
    )
    .get(input.now, input.teamId, input.workspaceId) as
    | { key: string; issue_number: number }
    | undefined;
  if (!team) throw new ResourceNotFoundError("Team not found.");

  const statusId =
    input.statusId ??
    (database
      .prepare(
        `SELECT id FROM workflow_states
          WHERE team_id = ?
          ORDER BY CASE WHEN is_default = 1 THEN 0 WHEN type = 'unstarted' THEN 1 ELSE 2 END,
                   position
          LIMIT 1`,
      )
      .get(input.teamId) as { id: string } | undefined)?.id;
  if (!statusId) throw new DomainValidationError("The team has no workflow states.");

  const references: z.infer<typeof issueChangesSchema> = {
    statusId,
    priority: input.priority,
    assigneeId: input.assigneeId,
    projectId: input.projectId,
    milestoneId: input.milestoneId,
    cycleId: input.cycleId,
    parentId: input.parentId,
    estimate: input.estimate,
    dueDate: input.dueDate,
    triageStatus: input.triageStatus,
    snoozedUntil: input.snoozedUntil,
    labelIds: input.labelIds,
  };
  validateIssueReferences(database, input.workspaceId, input.teamId, references);

  const issueId = createId("issue");
  const identifier = `${team.key.toUpperCase()}-${team.issue_number}`;
  const timestamps = statusTimestamps(database, statusId, input.now);
  const order = database
    .prepare(
      `SELECT COALESCE(MAX(sort_order), 0) + 1024 AS value
         FROM issues WHERE team_id = ? AND status_id = ?`,
    )
    .get(input.teamId, statusId) as { value: number };

  database
    .prepare(
      `INSERT INTO issues(
        id, workspace_id, team_id, identifier, number, title, description, status_id,
        priority, assignee_id, creator_id, project_id, milestone_id, cycle_id, parent_id, estimate,
        due_date, sort_order, triage_status, snoozed_until, completed_at, canceled_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      issueId,
      input.workspaceId,
      input.teamId,
      identifier,
      team.issue_number,
      input.title,
      input.description,
      statusId,
      input.priority ?? 0,
      input.assigneeId ?? null,
      input.actorId,
      input.projectId ?? null,
      input.milestoneId ?? null,
      input.cycleId ?? null,
      input.parentId ?? null,
      input.estimate ?? null,
      input.dueDate ?? null,
      Number(order.value),
      input.triageStatus ?? null,
      input.snoozedUntil ?? null,
      timestamps.completedAt,
      timestamps.canceledAt,
      input.now,
      input.now,
    );
  database
    .prepare(
      `INSERT INTO issue_identifier_aliases(
        id, workspace_id, issue_id, identifier, is_current, created_at
      ) VALUES (?, ?, ?, ?, 1, ?)`,
    )
    .run(createId("alias"), input.workspaceId, issueId, identifier, input.now);
  database
    .prepare("INSERT INTO issue_subscribers(issue_id, user_id, created_at) VALUES (?, ?, ?)")
    .run(issueId, input.actorId, input.now);
  if (input.assigneeId && input.assigneeId !== input.actorId) {
    database
      .prepare(
        "INSERT OR IGNORE INTO issue_subscribers(issue_id, user_id, created_at) VALUES (?, ?, ?)",
      )
      .run(issueId, input.assigneeId, input.now);
  }
  if (input.labelIds) {
    const insert = database.prepare("INSERT INTO issue_labels(issue_id, label_id) VALUES (?, ?)");
    for (const labelId of [...new Set(input.labelIds)]) insert.run(issueId, labelId);
  }

  finishMutation(database, {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    entityType: "issue",
    entityId: issueId,
    eventType: "issue.created",
    action: "created",
    metadata: { identifier, title: input.title, ...input.metadata },
    createdAt: input.now,
  });
  if (input.assigneeId && input.notifyAssignee !== false) {
    createNotification(database, {
      userId: input.assigneeId,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      type: "assignment",
      title: `${identifier} assigned to you`,
      body: input.title,
      entityType: "issue",
      entityId: issueId,
      createdAt: input.now,
    });
  }
  return getIssue(database, issueId);
}

function createIssue(
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<Issue> {
  const parsed = createIssueSchema.safeParse(payload);
  if (!parsed.success) {
    throw new DomainValidationError(parsed.error.issues[0]?.message ?? "Invalid issue data.");
  }
  requireTeamPermission(actorId, parsed.data.teamId, "create_issue");

  return transaction((database) => {
    const now = new Date().toISOString();
    const parent = insertCreatedIssue(database, {
      workspaceId,
      teamId: parsed.data.teamId,
      actorId,
      title: parsed.data.title,
      description: parsed.data.description ?? "",
      statusId: parsed.data.statusId,
      priority: parsed.data.priority,
      assigneeId: parsed.data.assigneeId,
      projectId: parsed.data.projectId,
      milestoneId: parsed.data.milestoneId,
      cycleId: parsed.data.cycleId,
      parentId: parsed.data.parentId,
      estimate: parsed.data.estimate,
      dueDate: parsed.data.dueDate,
      triageStatus: parsed.data.triageStatus,
      snoozedUntil: parsed.data.snoozedUntil,
      labelIds: parsed.data.labelIds,
      metadata: { subIssueCount: parsed.data.subIssues?.length ?? 0 },
      now,
    });

    for (const subIssue of parsed.data.subIssues ?? []) {
      insertCreatedIssue(database, {
        workspaceId,
        teamId: parent.teamId,
        actorId,
        title: subIssue.title,
        description: subIssue.description,
        statusId: parent.statusId,
        priority: parent.priority,
        assigneeId: parent.assigneeId,
        projectId: parent.projectId,
        milestoneId: parent.milestoneId,
        cycleId: parent.cycleId,
        parentId: parent.id,
        estimate: parent.estimate,
        dueDate: parent.dueDate,
        metadata: { parentId: parent.id, source: "sub-issue" },
        notifyAssignee: false,
        now,
      });
    }

    return {
      data: parent,
      eventType: "issue.created",
      resourceId: parent.id,
    };
  });
}

function updateComment(
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<Comment> {
  const parsed = commentUpdateSchema.safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid comment update.");
  const current = getCommentRow(getDatabase(), parsed.data.commentId);
  assertCommentIsAvailable(current, workspaceId);
  assertCanModifyComment(current, actorId);
  const body = "body" in parsed.data ? parsed.data.body : parsed.data.changes.body;
  const now = new Date().toISOString();

  const data = transaction((database) => {
    const comment = getCommentRow(database, current.id);
    assertCommentIsAvailable(comment, workspaceId);
    database
      .prepare(
        `UPDATE comments
            SET body = ?, edited_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(body, now, now, comment.id);
    finishMutation(database, {
      workspaceId,
      actorId,
      entityType: "comment",
      entityId: comment.id,
      eventType: "comment.updated",
      action: "edited",
      metadata: { issueId: comment.issue_id },
      createdAt: now,
    });
    return rowToComment(getCommentRow(database, comment.id));
  });
  return { data, eventType: "comment.updated", resourceId: current.id };
}

function deleteComment(
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<boolean> {
  const parsed = z.object({ commentId: z.string().min(1) }).strict().safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid comment deletion.");
  const current = getCommentRow(getDatabase(), parsed.data.commentId);
  assertCommentIsAvailable(current, workspaceId);
  assertCanModifyComment(current, actorId);
  const now = new Date().toISOString();

  const data = transaction((database) => {
    const comment = getCommentRow(database, current.id);
    assertCommentIsAvailable(comment, workspaceId);
    database
      .prepare(
        `UPDATE comments
            SET deleted_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(now, now, comment.id);
    finishMutation(database, {
      workspaceId,
      actorId,
      entityType: "comment",
      entityId: comment.id,
      eventType: "comment.deleted",
      action: "deleted",
      metadata: { issueId: comment.issue_id },
      createdAt: now,
    });
    return true;
  });
  return { data, eventType: "comment.deleted", resourceId: current.id };
}

function setCommentResolution(
  action: "comment.resolve" | "comment.reopen",
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<Comment> {
  const parsed = z.object({ commentId: z.string().min(1) }).strict().safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid comment resolution update.");
  const current = getCommentRow(getDatabase(), parsed.data.commentId);
  assertCommentIsAvailable(current, workspaceId);
  requireTeamPermission(actorId, current.team_id, "edit_issue");
  const now = new Date().toISOString();
  const resolvedAt = action === "comment.resolve" ? now : null;
  const eventType = action === "comment.resolve" ? "comment.resolved" : "comment.reopened";

  const data = transaction((database) => {
    const comment = getCommentRow(database, current.id);
    assertCommentIsAvailable(comment, workspaceId);
    database
      .prepare("UPDATE comments SET resolved_at = ?, updated_at = ? WHERE id = ?")
      .run(resolvedAt, now, comment.id);
    finishMutation(database, {
      workspaceId,
      actorId,
      entityType: "comment",
      entityId: comment.id,
      eventType,
      action: action === "comment.resolve" ? "resolved" : "reopened",
      metadata: { issueId: comment.issue_id },
      createdAt: now,
    });
    return rowToComment(getCommentRow(database, comment.id));
  });
  return { data, eventType, resourceId: current.id };
}

function toggleCommentReaction(
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<{ active: boolean; reaction: Reaction | null }> {
  const parsed = z
    .object({
      commentId: z.string().min(1),
      emoji: z.string().trim().min(1).max(64),
    })
    .strict()
    .safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid comment reaction.");
  const current = getCommentRow(getDatabase(), parsed.data.commentId);
  assertCommentIsAvailable(current, workspaceId);
  requireTeamPermission(actorId, current.team_id, "read");
  const now = new Date().toISOString();

  const result = transaction((database) => {
    const comment = getCommentRow(database, current.id);
    assertCommentIsAvailable(comment, workspaceId);
    const existing = database
      .prepare(
        `SELECT id, comment_id, user_id, emoji
           FROM comment_reactions
          WHERE comment_id = ? AND user_id = ? AND emoji = ?`,
      )
      .get(comment.id, actorId, parsed.data.emoji) as ReactionRow | undefined;

    if (existing) {
      database.prepare("DELETE FROM comment_reactions WHERE id = ?").run(existing.id);
      finishMutation(database, {
        workspaceId,
        actorId,
        entityType: "comment",
        entityId: comment.id,
        eventType: "comment.reaction.removed",
        action: "reaction.removed",
        metadata: { issueId: comment.issue_id, reactionId: existing.id, emoji: existing.emoji },
        createdAt: now,
      });
      return {
        data: { active: false, reaction: null },
        eventType: "comment.reaction.removed",
      };
    }

    const reaction: Reaction = {
      id: createId("reaction"),
      commentId: comment.id,
      userId: actorId,
      emoji: parsed.data.emoji,
    };
    database
      .prepare(
        `INSERT INTO comment_reactions(id, comment_id, user_id, emoji, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(reaction.id, reaction.commentId, reaction.userId, reaction.emoji, now);
    finishMutation(database, {
      workspaceId,
      actorId,
      entityType: "comment",
      entityId: comment.id,
      eventType: "comment.reaction.added",
      action: "reaction.added",
      metadata: { issueId: comment.issue_id, reactionId: reaction.id, emoji: reaction.emoji },
      createdAt: now,
    });
    return { data: { active: true, reaction }, eventType: "comment.reaction.added" };
  });
  return { data: result.data, eventType: result.eventType, resourceId: current.id };
}

function createIssueRelation(
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<IssueRelation> {
  const parsed = issueRelationCreateSchema.safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid issue relation.");
  if (parsed.data.issueId === parsed.data.relatedIssueId) {
    throw new DomainValidationError("An issue cannot be related to itself.");
  }

  const source = getIssueRow(getDatabase(), parsed.data.issueId);
  const target = getIssueRow(getDatabase(), parsed.data.relatedIssueId);
  if (
    source.workspace_id !== workspaceId ||
    target.workspace_id !== workspaceId ||
    source.trashed_at ||
    target.trashed_at
  ) {
    throw new ResourceNotFoundError("Issue not found.");
  }
  requireTeamPermission(actorId, source.team_id, "edit_issue");
  requireTeamPermission(actorId, target.team_id, "read");

  return transaction((database) => {
    const relationId = createId("relation");
    const now = new Date().toISOString();
    let issueId = source.id;
    let relatedIssueId = target.id;
    if (parsed.data.type === "related" && issueId.localeCompare(relatedIssueId) > 0) {
      [issueId, relatedIssueId] = [relatedIssueId, issueId];
    }

    const existing = (parsed.data.type === "related"
      ? database
          .prepare(
            `SELECT id FROM issue_relations
              WHERE type = 'related'
                AND ((issue_id = ? AND related_issue_id = ?)
                  OR (issue_id = ? AND related_issue_id = ?))
              LIMIT 1`,
          )
          .get(issueId, relatedIssueId, relatedIssueId, issueId)
      : database
          .prepare(
            `SELECT id FROM issue_relations
              WHERE issue_id = ? AND related_issue_id = ? AND type = ?`,
          )
          .get(issueId, relatedIssueId, parsed.data.type)) as { id: string } | undefined;
    if (existing) throw new ConflictError("This issue relation already exists.");

    if (
      (parsed.data.type === "blocks" || parsed.data.type === "duplicate") &&
      wouldCreateDirectedRelationCycle(
        database,
        issueId,
        relatedIssueId,
        parsed.data.type,
      )
    ) {
      throw new ConflictError(`The ${parsed.data.type} relation would create a cycle.`);
    }

    const metadata: Record<string, unknown> = {
      relationId,
      type: parsed.data.type,
      relatedIssueId: target.id,
    };
    if (parsed.data.type === "duplicate") {
      const sourceDuplicate = database
        .prepare("SELECT id FROM issue_relations WHERE issue_id = ? AND type = 'duplicate'")
        .get(source.id);
      if (sourceDuplicate) throw new ConflictError("This issue is already marked as a duplicate.");
      const targetDuplicate = database
        .prepare("SELECT id FROM issue_relations WHERE issue_id = ? AND type = 'duplicate'")
        .get(target.id);
      if (targetDuplicate) {
        throw new ConflictError("The duplicate target must be a canonical issue.");
      }
      const sourceHasDuplicates = database
        .prepare("SELECT id FROM issue_relations WHERE related_issue_id = ? AND type = 'duplicate'")
        .get(source.id);
      if (sourceHasDuplicates) {
        throw new ConflictError("An issue with duplicates cannot itself be marked as a duplicate.");
      }
      const duplicateStatus = database
        .prepare(
          `SELECT id FROM workflow_states
            WHERE team_id = ? AND type = 'canceled'
            ORDER BY CASE WHEN name = 'Duplicate' COLLATE NOCASE THEN 0 ELSE 1 END, position
            LIMIT 1`,
        )
        .get(source.team_id) as { id: string } | undefined;
      if (!duplicateStatus) {
        throw new DomainValidationError("The issue team has no canceled workflow state.");
      }
      Object.assign(metadata, {
        previousStatusId: source.status_id,
        previousTriageStatus: source.triage_status,
        previousSnoozedUntil: source.snoozed_until,
        previousCompletedAt: source.completed_at,
        previousCanceledAt: source.canceled_at,
      });
      database
        .prepare(
          `UPDATE issues
              SET status_id = ?, triage_status = ?, snoozed_until = NULL,
                  completed_at = NULL, canceled_at = ?, updated_at = ?, version = version + 1
            WHERE id = ?`,
        )
        .run(
          duplicateStatus.id,
          source.triage_status ? "declined" : null,
          now,
          now,
          source.id,
        );
    }

    database
      .prepare(
        `INSERT INTO issue_relations(
          id, issue_id, related_issue_id, type, created_by_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(relationId, issueId, relatedIssueId, parsed.data.type, actorId, now);
    finishMutation(database, {
      workspaceId,
      actorId,
      entityType: "issue",
      entityId: source.id,
      eventType: "issueRelation.created",
      action: "relation.created",
      metadata,
      createdAt: now,
    });
    return {
      data: rowToIssueRelation(getIssueRelationRow(database, relationId)),
      eventType: "issueRelation.created",
      resourceId: relationId,
    };
  });
}

function findDuplicateRestoreMetadata(
  database: Database,
  issueId: string,
  relationId: string,
): Record<string, unknown> | null {
  const activities = database
    .prepare(
      `SELECT metadata_json
         FROM activities
        WHERE entity_type = 'issue' AND entity_id = ? AND action = 'relation.created'
        ORDER BY created_at DESC, id DESC`,
    )
    .all(issueId) as Array<{ metadata_json: string }>;
  for (const activity of activities) {
    try {
      const metadata = JSON.parse(activity.metadata_json) as Record<string, unknown>;
      if (metadata.relationId === relationId && metadata.type === "duplicate") return metadata;
    } catch {
      // Ignore malformed historical activity data and continue to a safe fallback.
    }
  }
  return null;
}

function restoreIssueAfterDuplicate(
  database: Database,
  issue: IssueRow,
  relationId: string,
  now: string,
): void {
  const metadata = findDuplicateRestoreMetadata(database, issue.id, relationId);
  const previousStatusId =
    typeof metadata?.previousStatusId === "string" ? metadata.previousStatusId : null;
  let status = previousStatusId
    ? (database
        .prepare("SELECT id, type FROM workflow_states WHERE id = ? AND team_id = ?")
        .get(previousStatusId, issue.team_id) as { id: string; type: string } | undefined)
    : undefined;
  let usedFallback = false;
  if (!status) {
    status = database
      .prepare(
        `SELECT id, type FROM workflow_states
          WHERE team_id = ? AND type NOT IN ('completed', 'canceled')
          ORDER BY CASE WHEN is_default = 1 THEN 0 WHEN type = 'backlog' THEN 1
                        WHEN type = 'unstarted' THEN 2 ELSE 3 END, position
          LIMIT 1`,
      )
      .get(issue.team_id) as { id: string; type: string } | undefined;
    usedFallback = true;
  }
  if (!status) throw new DomainValidationError("The issue team has no restorable workflow state.");

  const triageValues = new Set(["pending", "accepted", "declined", "snoozed"]);
  const previousTriageStatus = metadata?.previousTriageStatus;
  const triageStatus =
    !usedFallback &&
    (previousTriageStatus === null ||
      (typeof previousTriageStatus === "string" && triageValues.has(previousTriageStatus)))
      ? previousTriageStatus
      : null;
  const previousSnoozedUntil = metadata?.previousSnoozedUntil;
  const snoozedUntil =
    !usedFallback && (previousSnoozedUntil === null || typeof previousSnoozedUntil === "string")
      ? previousSnoozedUntil
      : null;
  const previousCompletedAt = metadata?.previousCompletedAt;
  const completedAt =
    !usedFallback && (previousCompletedAt === null || typeof previousCompletedAt === "string")
      ? previousCompletedAt
      : status.type === "completed"
        ? now
        : null;
  const previousCanceledAt = metadata?.previousCanceledAt;
  const canceledAt =
    !usedFallback && (previousCanceledAt === null || typeof previousCanceledAt === "string")
      ? previousCanceledAt
      : status.type === "canceled"
        ? now
        : null;

  database
    .prepare(
      `UPDATE issues
          SET status_id = ?, triage_status = ?, snoozed_until = ?, completed_at = ?,
              canceled_at = ?, updated_at = ?, version = version + 1
        WHERE id = ?`,
    )
    .run(
      status.id,
      triageStatus as BindValue,
      snoozedUntil as BindValue,
      completedAt as BindValue,
      canceledAt as BindValue,
      now,
      issue.id,
    );
}

function deleteIssueRelation(
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<boolean> {
  const parsed = issueRelationDeleteSchema.safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid issue relation deletion.");
  const relation = findRelationBySelector(getDatabase(), parsed.data);
  const source = getIssueRow(getDatabase(), relation.issue_id);
  const target = getIssueRow(getDatabase(), relation.related_issue_id);
  if (source.workspace_id !== workspaceId || target.workspace_id !== workspaceId) {
    throw new ResourceNotFoundError("Issue relation not found.");
  }

  if (relation.type === "related") {
    requireTeamPermission(actorId, source.team_id, "read");
    requireTeamPermission(actorId, target.team_id, "read");
    const canEditSource = hasTeamPermission(
      getTeamPermissionContext(actorId, source.team_id),
      "edit_issue",
    );
    const canEditTarget = hasTeamPermission(
      getTeamPermissionContext(actorId, target.team_id),
      "edit_issue",
    );
    if (!canEditSource && !canEditTarget) throw new PermissionError();
  } else {
    requireTeamPermission(actorId, source.team_id, "edit_issue");
    requireTeamPermission(actorId, target.team_id, "read");
  }

  const now = new Date().toISOString();
  const data = transaction((database) => {
    const current = getIssueRelationRow(database, relation.id);
    const currentSource = getIssueRow(database, current.issue_id);
    database.prepare("DELETE FROM issue_relations WHERE id = ?").run(current.id);
    if (current.type === "duplicate") {
      restoreIssueAfterDuplicate(database, currentSource, current.id, now);
    }
    finishMutation(database, {
      workspaceId,
      actorId,
      entityType: "issue",
      entityId: current.issue_id,
      eventType: "issueRelation.deleted",
      action: "relation.deleted",
      metadata: {
        relationId: current.id,
        type: current.type,
        relatedIssueId: current.related_issue_id,
      },
      createdAt: now,
    });
    return true;
  });
  return { data, eventType: "issueRelation.deleted", resourceId: relation.id };
}

export function executeIssueAction(
  action: string,
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult | null {
  if (action === "issue.create") return createIssue(workspaceId, actorId, payload);

  if (action === "issue.update") {
    const parsed = z.object({ issueId: z.string().min(1), changes: issueChangesSchema }).strict().safeParse(payload);
    if (!parsed.success) throw new DomainValidationError("Invalid issue update.");
    const current = getIssueRow(getDatabase(), parsed.data.issueId);
    if (current.workspace_id !== workspaceId) throw new ResourceNotFoundError();
    requireTeamPermission(actorId, current.team_id, "edit_issue");
    if (parsed.data.changes.teamId && parsed.data.changes.teamId !== current.team_id) {
      const target = requireTeamPermission(actorId, parsed.data.changes.teamId, "edit_issue");
      if (target.workspaceId !== workspaceId) throw new ResourceNotFoundError();
    }
    const data = transaction((database) => applyIssueChanges(database, getIssueRow(database, parsed.data.issueId), parsed.data.changes, actorId, new Date().toISOString()));
    return { data, eventType: "issue.updated", resourceId: parsed.data.issueId };
  }

  if (action === "issue.bulkUpdate") {
    const parsed = z.object({ issueIds: z.array(z.string().min(1)).min(1).max(500), changes: issueChangesSchema }).strict().safeParse(payload);
    if (!parsed.success) throw new DomainValidationError("Invalid bulk issue update.");
    const ids = [...new Set(parsed.data.issueIds)];
    for (const issueId of ids) {
      const current = getIssueRow(getDatabase(), issueId);
      if (current.workspace_id !== workspaceId) throw new ResourceNotFoundError();
      requireTeamPermission(actorId, current.team_id, "edit_issue");
      if (parsed.data.changes.teamId && parsed.data.changes.teamId !== current.team_id) {
        const target = requireTeamPermission(actorId, parsed.data.changes.teamId, "edit_issue");
        if (target.workspaceId !== workspaceId) throw new ResourceNotFoundError();
      }
    }
    const updated = transaction((database) => ids.map((issueId) => applyIssueChanges(database, getIssueRow(database, issueId), parsed.data.changes, actorId, new Date().toISOString())));
    return { data: updated, eventType: "issue.bulk-updated", resourceId: ids[0]! };
  }

  if (["issue.archive", "issue.delete", "issue.restore"].includes(action)) {
    const parsed = z.object({ issueId: z.string().min(1) }).safeParse(payload);
    if (!parsed.success) throw new DomainValidationError("Invalid issue action.");
    const current = getIssueRow(getDatabase(), parsed.data.issueId);
    if (current.workspace_id !== workspaceId) throw new ResourceNotFoundError();
    requireTeamPermission(actorId, current.team_id, "edit_issue");
    const now = new Date().toISOString();
    const data = transaction((database) => {
      if (action === "issue.restore") {
        database.prepare("UPDATE issues SET archived_at = NULL, trashed_at = NULL, updated_at = ?, version = version + 1 WHERE id = ?").run(now, current.id);
      } else {
        const column = action === "issue.archive" ? "archived_at" : "trashed_at";
        database.prepare(`UPDATE issues SET ${column} = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(now, now, current.id);
      }
      finishMutation(database, { workspaceId, actorId, entityType: "issue", entityId: current.id, eventType: action.replace(".", "."), action: action.split(".")[1], createdAt: now });
      return getIssue(database, current.id);
    });
    return { data, eventType: action, resourceId: current.id };
  }

  if (action === "issue.subscribe") {
    const parsed = z.object({ issueId: z.string().min(1), subscribe: z.boolean() }).strict().safeParse(payload);
    if (!parsed.success) throw new DomainValidationError("Invalid subscription.");
    const current = getIssueRow(getDatabase(), parsed.data.issueId);
    if (current.workspace_id !== workspaceId) throw new ResourceNotFoundError();
    requireTeamPermission(actorId, current.team_id, "read");
    const data = transaction((database) => {
      if (parsed.data.subscribe) database.prepare("INSERT OR IGNORE INTO issue_subscribers(issue_id, user_id, created_at) VALUES (?, ?, ?)").run(current.id, actorId, new Date().toISOString());
      else database.prepare("DELETE FROM issue_subscribers WHERE issue_id = ? AND user_id = ?").run(current.id, actorId);
      return getIssue(database, current.id);
    });
    return { data, eventType: "issue.subscription-updated", resourceId: current.id };
  }

  if (action === "comment.update") return updateComment(workspaceId, actorId, payload);
  if (action === "comment.delete") return deleteComment(workspaceId, actorId, payload);
  if (action === "comment.resolve" || action === "comment.reopen") {
    return setCommentResolution(action, workspaceId, actorId, payload);
  }
  if (action === "comment.reaction.toggle") {
    return toggleCommentReaction(workspaceId, actorId, payload);
  }
  if (action === "issueRelation.create") {
    return createIssueRelation(workspaceId, actorId, payload);
  }
  if (action === "issueRelation.delete") {
    return deleteIssueRelation(workspaceId, actorId, payload);
  }

  if (action === "comment.create") {
    const parsed = z.object({ issueId: z.string().min(1), body: commentBodySchema, parentId: nullableId.optional() }).strict().safeParse(payload);
    if (!parsed.success) throw new DomainValidationError("Comment cannot be empty.");
    const current = getIssueRow(getDatabase(), parsed.data.issueId);
    if (current.workspace_id !== workspaceId) throw new ResourceNotFoundError();
    requireTeamPermission(actorId, current.team_id, "edit_issue");
    if (parsed.data.parentId) {
      const parent = getCommentRow(getDatabase(), parsed.data.parentId);
      assertCommentIsAvailable(parent, workspaceId);
      if (parent.issue_id !== current.id) {
        throw new DomainValidationError("Reply parent must belong to the same issue.");
      }
    }
    const now = new Date().toISOString();
    const commentId = createId("comment");
    const data = transaction((database) => {
      database.prepare(`INSERT INTO comments(id, issue_id, author_id, parent_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(commentId, current.id, actorId, parsed.data.parentId ?? null, parsed.data.body, now, now);
      database.prepare("INSERT OR IGNORE INTO issue_subscribers(issue_id, user_id, created_at) VALUES (?, ?, ?)").run(current.id, actorId, now);
      const mentionedUserIds = mentionedWorkspaceUsers(database, workspaceId, parsed.data.body);
      for (const userId of mentionedUserIds) {
        database.prepare("INSERT OR IGNORE INTO issue_subscribers(issue_id, user_id, created_at) VALUES (?, ?, ?)").run(current.id, userId, now);
        createNotification(database, {
          userId,
          workspaceId,
          actorId,
          type: "mention",
          title: `You were mentioned on ${current.identifier}`,
          body: parsed.data.body.slice(0, 180),
          entityType: "comment",
          entityId: commentId,
          createdAt: now,
        });
      }
      finishMutation(database, { workspaceId, actorId, entityType: "comment", entityId: commentId, eventType: "comment.created", action: "commented", metadata: { issueId: current.id }, createdAt: now });
      const subscribers = database.prepare("SELECT user_id FROM issue_subscribers WHERE issue_id = ?").all(current.id) as Array<{ user_id: string }>;
      const mentionedSet = new Set(mentionedUserIds);
      for (const subscriber of subscribers) {
        if (mentionedSet.has(subscriber.user_id)) continue;
        createNotification(database, { userId: subscriber.user_id, workspaceId, actorId, type: "comment", title: `New comment on ${current.identifier}`, body: parsed.data.body.slice(0, 180), entityType: "comment", entityId: commentId, createdAt: now });
      }
      return { id: commentId, issueId: current.id, authorId: actorId, parentId: parsed.data.parentId ?? null, body: parsed.data.body, resolvedAt: null, createdAt: now, updatedAt: now };
    });
    return { data, eventType: "comment.created", resourceId: commentId };
  }

  return null;
}
