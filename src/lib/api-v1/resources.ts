import "server-only";

import { requireWorkspacePermission } from "@/lib/auth";
import { getBootstrapData } from "@/lib/bootstrap";
import { getAll } from "@/lib/db";
import type { BootstrapData, Issue } from "@/lib/domain";

import type { ApiV1Context, ApiV1PageInfo } from "./http";
import { encodeApiV1Cursor, readApiV1Pagination } from "./pagination";

type IssueCursor = readonly [updatedAt: string, id: string];

interface IssueRow extends Omit<Issue, "labelIds" | "priority" | "subscriberIds"> {
  readonly label_ids_json: string;
  readonly priority: number;
  readonly subscriber_ids_json: string;
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

function issueFromRow(row: IssueRow): Issue {
  const { label_ids_json, subscriber_ids_json, ...issue } = row;
  return {
    ...issue,
    labelIds: parseJsonArray(label_ids_json),
    priority: row.priority as Issue["priority"],
    subscriberIds: parseJsonArray(subscriber_ids_json),
  };
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
