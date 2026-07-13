import "server-only";

import { requireWorkspacePermission } from "@/lib/auth";
import { getBootstrapData } from "@/lib/bootstrap";
import { getAll } from "@/lib/db";
import type {
  BootstrapData,
  Issue,
  Membership,
  Project,
  Team,
  WorkspaceRole,
} from "@/lib/domain";

import type { ApiV1Context, ApiV1PageInfo } from "./http";
import { encodeApiV1Cursor, readApiV1Pagination } from "./pagination";

type IssueCursor = readonly [updatedAt: string, id: string];
type MemberCursor = readonly [name: string, id: string];
type ProjectCursor = readonly [sortOrder: number, name: string, id: string];
type TeamCursor = readonly [name: string, id: string];

interface IssueRow extends Omit<Issue, "labelIds" | "priority" | "subscriberIds"> {
  readonly label_ids_json: string;
  readonly priority: number;
  readonly subscriber_ids_json: string;
}

interface TeamRow extends Omit<Team, "isPrivate" | "triageEnabled"> {
  readonly isPrivate: number;
  readonly triageEnabled: number;
}

interface ProjectRow extends Omit<Project, "memberIds" | "priority" | "teamIds"> {
  readonly cursorSortOrder: number;
  readonly member_ids_json: string;
  readonly priority: number;
  readonly team_ids_json: string;
}

interface MembershipRow {
  readonly id: string;
  readonly joined_at: string;
  readonly role: WorkspaceRole;
  readonly status: Membership["status"];
  readonly user_avatar_url: string | null;
  readonly user_created_at: string;
  readonly user_email: string;
  readonly user_id: string;
  readonly user_name: string;
  readonly workspace_id: string;
}

export interface ApiV1ResourcePage<T> {
  readonly data: readonly T[];
  readonly pageInfo: ApiV1PageInfo;
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function isIssueCursor(value: unknown): value is IssueCursor {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    value[0].length > 0 &&
    typeof value[1] === "string" &&
    value[1].length > 0
  );
}

function isTeamCursor(value: unknown): value is TeamCursor {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    value[0].length > 0 &&
    typeof value[1] === "string" &&
    value[1].length > 0
  );
}

function isProjectCursor(value: unknown): value is ProjectCursor {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "string" &&
    value[1].length > 0 &&
    typeof value[2] === "string" &&
    value[2].length > 0
  );
}

function isMemberCursor(value: unknown): value is MemberCursor {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    value[0].length > 0 &&
    typeof value[1] === "string" &&
    value[1].length > 0
  );
}

function issueFromRow(row: IssueRow): Issue {
  const { label_ids_json, subscriber_ids_json, ...issue } = row;
  return {
    ...issue,
    labelIds: parseJsonArray(label_ids_json),
    priority: row.priority as Issue["priority"],
    subscriberIds: parseJsonArray(subscriber_ids_json),
  };
}

function projectFromRow(row: ProjectRow): Project {
  const { cursorSortOrder, member_ids_json, team_ids_json, ...project } = row;
  void cursorSortOrder;
  return {
    ...project,
    memberIds: parseJsonArray(member_ids_json),
    priority: row.priority as Project["priority"],
    teamIds: parseJsonArray(team_ids_json),
  };
}

function membershipFromRow(row: MembershipRow): Membership {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at,
    user: {
      id: row.user_id,
      name: row.user_name,
      email: row.user_email,
      avatarUrl: row.user_avatar_url,
      createdAt: row.user_created_at,
    },
  };
}

function compareMemberPosition(
  left: Pick<Membership, "id" | "user">,
  right: MemberCursor,
): number {
  const byName = left.user.name.localeCompare(right[0], "en", {
    sensitivity: "base",
  });
  return byName || left.id.localeCompare(right[1]);
}

export function getApiV1WorkspaceData(context: ApiV1Context): BootstrapData {
  requireWorkspacePermission(context.userId, context.workspaceId, "read");
  return getBootstrapData(context.userId, context.workspaceSlug);
}

export function getApiV1IssuePage(
  request: Request,
  context: ApiV1Context,
): ApiV1ResourcePage<Issue> {
  requireWorkspacePermission(context.userId, context.workspaceId, "read");
  const pagination = readApiV1Pagination(
    request,
    "issues",
    context.workspaceId,
    isIssueCursor,
  );
  const cursorClause = pagination.cursor
    ? "AND (i.updated_at < ? OR (i.updated_at = ? AND i.id > ?))"
    : "";
  const cursorParameters = pagination.cursor
    ? [pagination.cursor[0], pagination.cursor[0], pagination.cursor[1]]
    : [];
  const rows = getAll<IssueRow>(
    `WITH accessible_teams AS (
       SELECT t.id
         FROM teams t
         LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = ?
        WHERE t.workspace_id = ?
          AND (
            (t.is_private = 0 AND ? IN ('admin', 'member')) OR
            tm.user_id IS NOT NULL
          )
     )
     SELECT i.id, i.workspace_id AS workspaceId, i.team_id AS teamId,
            i.identifier, i.number, i.title, i.description, i.status_id AS statusId,
            i.priority, i.assignee_id AS assigneeId, i.creator_id AS creatorId,
            i.project_id AS projectId, i.milestone_id AS milestoneId,
            i.cycle_id AS cycleId, i.parent_id AS parentId,
            i.estimate, i.due_date AS dueDate, i.sort_order AS sortOrder,
            i.triage_status AS triageStatus, i.snoozed_until AS snoozedUntil,
            i.completed_at AS completedAt, i.canceled_at AS canceledAt,
            i.archived_at AS archivedAt, i.trashed_at AS trashedAt,
            i.created_at AS createdAt, i.updated_at AS updatedAt,
            COALESCE((
              SELECT json_group_array(il.label_id)
                FROM issue_labels il
                JOIN labels l ON l.id = il.label_id
               WHERE il.issue_id = i.id
                 AND l.workspace_id = i.workspace_id
                 AND (
                   l.team_id IS NULL OR
                   l.team_id IN (SELECT id FROM accessible_teams)
                 )
            ), '[]') AS label_ids_json,
            COALESCE((
              SELECT json_group_array(s.user_id)
                FROM issue_subscribers s
               WHERE s.issue_id = i.id
            ), '[]') AS subscriber_ids_json
       FROM issues i
       JOIN accessible_teams accessible_team ON accessible_team.id = i.team_id
      WHERE i.workspace_id = ?
        AND i.trashed_at IS NULL
        ${cursorClause}
      ORDER BY i.updated_at DESC, i.id ASC
      LIMIT ?`,
    context.userId,
    context.workspaceId,
    context.role,
    context.workspaceId,
    ...cursorParameters,
    pagination.limit + 1,
  );
  const hasNextPage = rows.length > pagination.limit;
  const pageRows = rows.slice(0, pagination.limit);
  const lastRow = pageRows.at(-1);
  return {
    data: pageRows.map(issueFromRow),
    pageInfo: {
      endCursor: lastRow
        ? encodeApiV1Cursor("issues", context.workspaceId, [
            lastRow.updatedAt,
            lastRow.id,
          ] satisfies IssueCursor)
        : null,
      hasNextPage,
      limit: pagination.limit,
    },
  };
}

export function getApiV1TeamPage(
  request: Request,
  context: ApiV1Context,
): ApiV1ResourcePage<Team> {
  requireWorkspacePermission(context.userId, context.workspaceId, "read");
  const pagination = readApiV1Pagination(
    request,
    "teams",
    context.workspaceId,
    isTeamCursor,
  );
  const cursorClause = pagination.cursor
    ? `AND (
         t.name COLLATE NOCASE > ? OR
         (t.name COLLATE NOCASE = ? AND t.id > ?)
       )`
    : "";
  const cursorParameters = pagination.cursor
    ? [pagination.cursor[0], pagination.cursor[0], pagination.cursor[1]]
    : [];
  const rows = getAll<TeamRow>(
    `SELECT t.id, t.workspace_id AS workspaceId, t.name, t.key,
            t.description, t.color, t.icon, t.is_private AS isPrivate,
            t.triage_enabled AS triageEnabled, t.created_at AS createdAt
       FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = ?
      WHERE t.workspace_id = ?
        AND (
          (t.is_private = 0 AND ? IN ('admin', 'member')) OR
          tm.user_id IS NOT NULL
        )
        ${cursorClause}
      ORDER BY t.name COLLATE NOCASE ASC, t.id ASC
      LIMIT ?`,
    context.userId,
    context.workspaceId,
    context.role,
    ...cursorParameters,
    pagination.limit + 1,
  );
  const hasNextPage = rows.length > pagination.limit;
  const pageRows = rows.slice(0, pagination.limit);
  const lastRow = pageRows.at(-1);
  return {
    data: pageRows.map((row) => ({
      ...row,
      isPrivate: Boolean(row.isPrivate),
      triageEnabled: Boolean(row.triageEnabled),
    })),
    pageInfo: {
      endCursor: lastRow
        ? encodeApiV1Cursor("teams", context.workspaceId, [
            lastRow.name,
            lastRow.id,
          ] satisfies TeamCursor)
        : null,
      hasNextPage,
      limit: pagination.limit,
    },
  };
}

export function getApiV1ProjectPage(
  request: Request,
  context: ApiV1Context,
): ApiV1ResourcePage<Project> {
  requireWorkspacePermission(context.userId, context.workspaceId, "read");
  const pagination = readApiV1Pagination(
    request,
    "projects",
    context.workspaceId,
    isProjectCursor,
  );
  const cursorClause = pagination.cursor
    ? `AND (
         p.sort_order > ? OR
         (p.sort_order = ? AND p.name COLLATE NOCASE > ?) OR
         (p.sort_order = ? AND p.name COLLATE NOCASE = ? AND p.id > ?)
       )`
    : "";
  const cursorParameters = pagination.cursor
    ? [
        pagination.cursor[0],
        pagination.cursor[0],
        pagination.cursor[1],
        pagination.cursor[0],
        pagination.cursor[1],
        pagination.cursor[2],
      ]
    : [];
  const rows = getAll<ProjectRow>(
    `WITH accessible_teams AS (
       SELECT t.id
         FROM teams t
         LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = ?
        WHERE t.workspace_id = ?
          AND (
            (t.is_private = 0 AND ? IN ('admin', 'member')) OR
            tm.user_id IS NOT NULL
          )
     )
     SELECT p.id, p.workspace_id AS workspaceId,
            CASE
              WHEN p.team_id IN (SELECT id FROM accessible_teams) THEN p.team_id
              ELSE NULL
            END AS teamId,
            p.name, p.slug, p.summary, p.description, p.status, p.priority,
            p.lead_id AS leadId, p.color, p.icon, p.start_date AS startDate,
            p.target_date AS targetDate, p.archived_at AS archivedAt,
            p.created_at AS createdAt, p.updated_at AS updatedAt,
            p.sort_order AS cursorSortOrder,
            COALESCE((
              SELECT json_group_array(pt.team_id)
                FROM project_teams pt
               WHERE pt.project_id = p.id
                 AND pt.team_id IN (SELECT id FROM accessible_teams)
            ), '[]') AS team_ids_json,
            COALESCE((
              SELECT json_group_array(pm.user_id)
                FROM project_members pm
               WHERE pm.project_id = p.id
            ), '[]') AS member_ids_json
       FROM projects p
      WHERE p.workspace_id = ?
        AND p.archived_at IS NULL
        AND p.trashed_at IS NULL
        AND (
          EXISTS (
            SELECT 1
              FROM project_teams visible_project_team
              JOIN accessible_teams accessible_team
                ON accessible_team.id = visible_project_team.team_id
             WHERE visible_project_team.project_id = p.id
          ) OR
          (
            ? <> 'guest' AND
            NOT EXISTS (
              SELECT 1 FROM project_teams any_project_team
               WHERE any_project_team.project_id = p.id
            )
          )
        )
        ${cursorClause}
      ORDER BY p.sort_order ASC, p.name COLLATE NOCASE ASC, p.id ASC
      LIMIT ?`,
    context.userId,
    context.workspaceId,
    context.role,
    context.workspaceId,
    context.role,
    ...cursorParameters,
    pagination.limit + 1,
  );
  const hasNextPage = rows.length > pagination.limit;
  const pageRows = rows.slice(0, pagination.limit);
  const lastRow = pageRows.at(-1);
  return {
    data: pageRows.map(projectFromRow),
    pageInfo: {
      endCursor: lastRow
        ? encodeApiV1Cursor("projects", context.workspaceId, [
            lastRow.cursorSortOrder,
            lastRow.name,
            lastRow.id,
          ] satisfies ProjectCursor)
        : null,
      hasNextPage,
      limit: pagination.limit,
    },
  };
}

export function getApiV1MemberPage(
  request: Request,
  context: ApiV1Context,
): ApiV1ResourcePage<Membership> {
  requireWorkspacePermission(context.userId, context.workspaceId, "read");
  const pagination = readApiV1Pagination(
    request,
    "members",
    context.workspaceId,
    isMemberCursor,
  );

  let memberships: Membership[];
  if (context.role === "guest") {
    memberships = [...getBootstrapData(context.userId, context.workspaceSlug).memberships].sort(
      (left, right) => compareMemberPosition(left, [right.user.name, right.id]),
    );
    const cursor = pagination.cursor;
    if (cursor) {
      memberships = memberships.filter(
        (membership) => compareMemberPosition(membership, cursor) > 0,
      );
    }
    memberships = memberships.slice(0, pagination.limit + 1);
  } else {
    const cursorClause = pagination.cursor
      ? `AND (
           u.name COLLATE NOCASE > ? OR
           (u.name COLLATE NOCASE = ? AND wm.id > ?)
         )`
      : "";
    const cursorParameters = pagination.cursor
      ? [pagination.cursor[0], pagination.cursor[0], pagination.cursor[1]]
      : [];
    memberships = getAll<MembershipRow>(
      `SELECT wm.id, wm.workspace_id, wm.user_id, wm.role, wm.status, wm.joined_at,
              u.name AS user_name, u.email AS user_email,
              u.avatar_url AS user_avatar_url, u.created_at AS user_created_at
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = ?
          ${cursorClause}
        ORDER BY u.name COLLATE NOCASE ASC, wm.id ASC
        LIMIT ?`,
      context.workspaceId,
      ...cursorParameters,
      pagination.limit + 1,
    ).map(membershipFromRow);
  }

  const hasNextPage = memberships.length > pagination.limit;
  const data = memberships.slice(0, pagination.limit);
  const lastMembership = data.at(-1);
  return {
    data,
    pageInfo: {
      endCursor: lastMembership
        ? encodeApiV1Cursor("members", context.workspaceId, [
            lastMembership.user.name,
            lastMembership.id,
          ] satisfies MemberCursor)
        : null,
      hasNextPage,
      limit: pagination.limit,
    },
  };
}
