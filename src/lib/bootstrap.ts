import "server-only";

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import type {
  Activity,
  ApiKeySummary,
  Attachment,
  BootstrapData,
  Comment,
  Cycle,
  Document,
  EntityType,
  Favorite,
  Initiative,
  Issue,
  IssueRelation,
  IssueTemplate,
  Label,
  Membership,
  Notification,
  NotificationPreferences,
  Project,
  ProjectDependency,
  ProjectMilestone,
  ProjectUpdate,
  Reaction,
  RecurringIssue,
  SavedView,
  TeamMember,
  User,
  ViewFilters,
  Webhook,
  WorkflowState,
  Workspace,
  WorkspaceRole,
} from "@/lib/domain";
import { getAll, getDatabaseFilePath, getOne } from "@/lib/db";
import { getAccessibleTeams } from "@/lib/auth";
import { preferredEnvironmentFlag } from "@/lib/runtime-config";

interface WorkspaceContextRow {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  workspace_icon: string;
  workspace_timezone: string;
  workspace_created_at: string;
  membership_id: string;
  membership_role: WorkspaceRole;
  membership_status: "active" | "suspended";
  joined_at: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_avatar_url: string | null;
  user_created_at: string;
}

interface MembershipRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  status: "active" | "suspended";
  joined_at: string;
  user_name: string;
  user_email: string;
  user_avatar_url: string | null;
  user_created_at: string;
}

interface TeamMemberRow {
  team_id: string;
  user_id: string;
  role: TeamMember["role"];
}

interface IssueRow extends Omit<Issue, "labelIds" | "subscriberIds" | "priority"> {
  priority: number;
  label_ids_json: string;
  subscriber_ids_json: string;
}

interface AttachmentRow {
  id: string;
  issue_id: string | null;
  comment_id: string | null;
  user_id: string;
  name: string;
  url: string;
  size: number;
  mime: string;
  created_at: string;
}

interface ActivityRow extends Omit<Activity, "metadata"> {
  metadata_json: string;
}

interface ProjectRow extends Omit<Project, "priority" | "teamIds" | "memberIds"> {
  priority: number;
  team_ids_json: string;
  member_ids_json: string;
}

interface InitiativeRow extends Omit<Initiative, "priority" | "projectIds"> {
  priority: number;
  project_ids_json: string;
}

interface ViewRow extends Omit<SavedView, "filters" | "isShared"> {
  filters_json: string;
  is_shared: number;
}

interface TemplateRow extends Omit<IssueTemplate, "defaults" | "subIssues"> {
  defaults_json: string;
  sub_issues_json: string;
}

interface WebhookRow extends Omit<Webhook, "events" | "isActive" | "signingReady"> {
  events_json: string;
  is_active: number;
  signing_ready: number;
}

export class BootstrapNotFoundError extends Error {
  readonly status = 404;

  constructor(message = "Workspace not found.") {
    super(message);
    this.name = "BootstrapNotFoundError";
  }
}

export class BootstrapPermissionError extends Error {
  readonly status = 403;

  constructor(message = "Workspace access is suspended.") {
    super(message);
    this.name = "BootstrapPermissionError";
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function placeholders(values: readonly string[]): string {
  return values.length > 0 ? values.map(() => "?").join(", ") : "NULL";
}

function workspaceFromContext(row: WorkspaceContextRow): Workspace {
  return {
    id: row.workspace_id,
    name: row.workspace_name,
    slug: row.workspace_slug,
    icon: row.workspace_icon,
    timezone: row.workspace_timezone,
    createdAt: row.workspace_created_at,
  };
}

function userFromContext(row: WorkspaceContextRow): User {
  return {
    id: row.user_id,
    name: row.user_name,
    email: row.user_email,
    avatarUrl: row.user_avatar_url,
    createdAt: row.user_created_at,
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

/**
 * Optionally seeds the rich local fixture in an explicitly enabled development
 * environment. Production requests never create accounts or known credentials.
 */
export function ensureSeedData(): boolean {
  if (
    process.env.NODE_ENV === "production" ||
    !preferredEnvironmentFlag(
      process.env.MICRO_LINEAR_DEMO_MODE,
      process.env.ORBIT_DEMO_MODE,
    )
  ) {
    return false;
  }

  const count = getOne<{ count: number }>("SELECT COUNT(*) AS count FROM users");
  if (Number(count?.count ?? 0) > 0) return false;

  const cwd = process.cwd();
  const cli = resolve(cwd, "node_modules/tsx/dist/cli.mjs");
  const script = resolve(cwd, "scripts/seed.ts");
  const result = spawnSync(process.execPath, [cli, script], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
      MICRO_LINEAR_DB_PATH: getDatabaseFilePath(),
    },
  });

  if (result.error || result.status !== 0) {
    const details = result.error?.message || result.stderr.trim() || "Unknown seed failure";
    throw new Error(`Unable to initialize the local database: ${details}`);
  }

  const seeded = getOne<{ count: number }>("SELECT COUNT(*) AS count FROM users");
  if (Number(seeded?.count ?? 0) === 0) {
    throw new Error("The seed command completed without creating a user.");
  }
  return true;
}

function sanitizeViewFilters(
  filters: ViewFilters,
  access: {
    teamIds: ReadonlySet<string>;
    stateIds: ReadonlySet<string>;
    labelIds: ReadonlySet<string>;
    projectIds: ReadonlySet<string>;
    cycleIds: ReadonlySet<string>;
    userIds: ReadonlySet<string>;
  },
): ViewFilters | null {
  const sanitizeRequired = (
    values: string[] | undefined,
    allowed: ReadonlySet<string>,
  ): string[] | undefined | null => {
    if (!values) return undefined;
    const visible = values.filter((value) => allowed.has(value));
    return values.length > 0 && visible.length === 0 ? null : visible;
  };

  const teamIds = sanitizeRequired(filters.teamIds, access.teamIds);
  const statusIds = sanitizeRequired(filters.statusIds, access.stateIds);
  const labelIds = sanitizeRequired(filters.labelIds, access.labelIds);
  const projectIds = sanitizeRequired(filters.projectIds, access.projectIds);
  const cycleIds = sanitizeRequired(filters.cycleIds, access.cycleIds);
  const assigneeIds = sanitizeRequired(filters.assigneeIds, access.userIds);
  const creatorIds = sanitizeRequired(filters.creatorIds, access.userIds);
  if (
    teamIds === null ||
    statusIds === null ||
    labelIds === null ||
    projectIds === null ||
    cycleIds === null ||
    assigneeIds === null ||
    creatorIds === null
  ) {
    return null;
  }

  return {
    ...filters,
    ...(teamIds ? { teamIds } : {}),
    ...(statusIds ? { statusIds } : {}),
    ...(labelIds ? { labelIds } : {}),
    ...(projectIds ? { projectIds } : {}),
    ...(cycleIds ? { cycleIds } : {}),
    ...(assigneeIds ? { assigneeIds } : {}),
    ...(creatorIds ? { creatorIds } : {}),
  };
}

function sanitizeTemplateDefaults(
  defaults: Partial<Issue>,
  access: {
    teamIds: ReadonlySet<string>;
    stateIds: ReadonlySet<string>;
    labelIds: ReadonlySet<string>;
    projectIds: ReadonlySet<string>;
    cycleIds: ReadonlySet<string>;
    userIds: ReadonlySet<string>;
  },
): Partial<Issue> {
  const sanitized = { ...defaults };
  if (sanitized.teamId && !access.teamIds.has(sanitized.teamId)) delete sanitized.teamId;
  if (sanitized.statusId && !access.stateIds.has(sanitized.statusId)) delete sanitized.statusId;
  if (sanitized.projectId && !access.projectIds.has(sanitized.projectId)) delete sanitized.projectId;
  if (sanitized.cycleId && !access.cycleIds.has(sanitized.cycleId)) delete sanitized.cycleId;
  if (sanitized.assigneeId && !access.userIds.has(sanitized.assigneeId)) delete sanitized.assigneeId;
  if (sanitized.creatorId && !access.userIds.has(sanitized.creatorId)) delete sanitized.creatorId;
  if (sanitized.labelIds) {
    sanitized.labelIds = sanitized.labelIds.filter((labelId) => access.labelIds.has(labelId));
  }
  if (sanitized.subscriberIds) {
    sanitized.subscriberIds = sanitized.subscriberIds.filter((userId) => access.userIds.has(userId));
  }
  return sanitized;
}

function entityIsVisible(
  entityType: EntityType | "comment" | "member" | "team",
  entityId: string,
  visible: {
    issues: ReadonlySet<string>;
    comments: ReadonlySet<string>;
    projects: ReadonlySet<string>;
    cycles: ReadonlySet<string>;
    initiatives: ReadonlySet<string>;
    documents: ReadonlySet<string>;
    views: ReadonlySet<string>;
    teams: ReadonlySet<string>;
    members: ReadonlySet<string>;
  },
): boolean {
  switch (entityType) {
    case "issue":
      return visible.issues.has(entityId);
    case "comment":
      return visible.comments.has(entityId);
    case "project":
      return visible.projects.has(entityId);
    case "cycle":
      return visible.cycles.has(entityId);
    case "initiative":
      return visible.initiatives.has(entityId);
    case "document":
      return visible.documents.has(entityId);
    case "view":
      return visible.views.has(entityId);
    case "team":
      return visible.teams.has(entityId);
    case "member":
      return visible.members.has(entityId);
    default:
      return false;
  }
}

export function getBootstrapData(userId: string, workspaceSlug: string): BootstrapData {
  const context = getOne<WorkspaceContextRow>(
    `SELECT
       w.id AS workspace_id, w.name AS workspace_name, w.slug AS workspace_slug,
       w.icon AS workspace_icon, w.timezone AS workspace_timezone,
       w.created_at AS workspace_created_at,
       wm.id AS membership_id, wm.role AS membership_role,
       wm.status AS membership_status, wm.joined_at,
       u.id AS user_id, u.name AS user_name, u.email AS user_email,
       u.avatar_url AS user_avatar_url, u.created_at AS user_created_at
     FROM workspaces w
     JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ?
     JOIN users u ON u.id = wm.user_id AND u.disabled_at IS NULL
     WHERE w.slug = ? COLLATE NOCASE`,
    userId,
    workspaceSlug,
  );
  if (!context) throw new BootstrapNotFoundError();
  if (context.membership_status !== "active") throw new BootstrapPermissionError();

  const workspace = workspaceFromContext(context);
  const currentUser = userFromContext(context);
  const isGuest = context.membership_role === "guest";
  const isAdmin = context.membership_role === "admin";

  const allMemberships = getAll<MembershipRow>(
    `SELECT wm.id, wm.workspace_id, wm.user_id, wm.role, wm.status, wm.joined_at,
            u.name AS user_name, u.email AS user_email, u.avatar_url AS user_avatar_url,
            u.created_at AS user_created_at
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = ?
      ORDER BY u.name COLLATE NOCASE`,
    workspace.id,
  ).map(membershipFromRow);

  const currentMembership = allMemberships.find((membership) => membership.userId === userId);
  if (!currentMembership) throw new BootstrapNotFoundError();

  const teams = getAccessibleTeams(userId, workspace.id);
  const teamIds = teams.map((team) => team.id);
  const teamIdSet = new Set(teamIds);
  const teamSlots = placeholders(teamIds);

  const teamMembers = getAll<TeamMemberRow>(
    `SELECT team_id, user_id, role
       FROM team_members
      WHERE team_id IN (${teamSlots})
      ORDER BY team_id, user_id`,
    ...teamIds,
  ).map<TeamMember>((row) => ({ teamId: row.team_id, userId: row.user_id, role: row.role }));

  const states = getAll<WorkflowState>(
    `SELECT id, team_id AS teamId, name, type, color, position
       FROM workflow_states
      WHERE team_id IN (${teamSlots})
      ORDER BY team_id, position`,
    ...teamIds,
  );
  const stateIdSet = new Set(states.map((state) => state.id));

  const labels = getAll<Label>(
    `SELECT l.id, l.workspace_id AS workspaceId, l.name, l.color, l.description,
            lg.name AS groupName
       FROM labels l
       LEFT JOIN label_groups lg ON lg.id = l.group_id
      WHERE l.workspace_id = ?
        AND (l.team_id IS NULL OR l.team_id IN (${teamSlots}))
      ORDER BY COALESCE(lg.name, ''), l.name COLLATE NOCASE`,
    workspace.id,
    ...teamIds,
  );
  const labelIdSet = new Set(labels.map((label) => label.id));

  const rawIssues = getAll<IssueRow>(
    `SELECT i.id, i.workspace_id AS workspaceId, i.team_id AS teamId,
            i.identifier, i.number, i.title, i.description, i.status_id AS statusId,
            i.priority, i.assignee_id AS assigneeId, i.creator_id AS creatorId,
            i.project_id AS projectId, i.milestone_id AS milestoneId,
            i.cycle_id AS cycleId, i.parent_id AS parentId,
            i.estimate, i.due_date AS dueDate, i.sort_order AS sortOrder,
            i.triage_status AS triageStatus, i.snoozed_until AS snoozedUntil,
            i.completed_at AS completedAt, i.canceled_at AS canceledAt,
            i.archived_at AS archivedAt, i.trashed_at AS trashedAt,
            i.created_at AS createdAt, i.updated_at AS updatedAt,
            COALESCE((SELECT json_group_array(il.label_id) FROM issue_labels il WHERE il.issue_id = i.id), '[]') AS label_ids_json,
            COALESCE((SELECT json_group_array(s.user_id) FROM issue_subscribers s WHERE s.issue_id = i.id), '[]') AS subscriber_ids_json
       FROM issues i
      WHERE i.workspace_id = ? AND i.team_id IN (${teamSlots})
      ORDER BY i.updated_at DESC, i.id`,
    workspace.id,
    ...teamIds,
  );
  const issues: Issue[] = rawIssues.map((issue) => ({
    ...issue,
    priority: issue.priority as Issue["priority"],
    labelIds: parseJson<string[]>(issue.label_ids_json, []).filter((id) => labelIdSet.has(id)),
    subscriberIds: parseJson<string[]>(issue.subscriber_ids_json, []),
  }));
  for (const issue of issues) {
    delete (issue as Partial<IssueRow>).label_ids_json;
    delete (issue as Partial<IssueRow>).subscriber_ids_json;
  }
  const issueIds = issues.map((issue) => issue.id);
  const issueIdSet = new Set(issueIds);
  const issueSlots = placeholders(issueIds);

  const relations = getAll<IssueRelation>(
    `SELECT id, issue_id AS issueId, related_issue_id AS relatedIssueId, type, created_at AS createdAt
       FROM issue_relations
      WHERE issue_id IN (${issueSlots}) AND related_issue_id IN (${issueSlots})
      ORDER BY created_at`,
    ...issueIds,
    ...issueIds,
  );

  const comments = getAll<Comment>(
    `SELECT id, issue_id AS issueId, author_id AS authorId, parent_id AS parentId,
            body, resolved_at AS resolvedAt, created_at AS createdAt, updated_at AS updatedAt
       FROM comments
      WHERE issue_id IN (${issueSlots}) AND deleted_at IS NULL
      ORDER BY created_at`,
    ...issueIds,
  );
  const commentIds = comments.map((comment) => comment.id);
  const commentIdSet = new Set(commentIds);
  const commentSlots = placeholders(commentIds);

  const reactions = getAll<Reaction>(
    `SELECT id, comment_id AS commentId, user_id AS userId, emoji
       FROM comment_reactions
      WHERE comment_id IN (${commentSlots})
      ORDER BY created_at`,
    ...commentIds,
  );

  const rawAttachments = getAll<AttachmentRow>(
    `SELECT f.id, ia.issue_id, ca.comment_id, f.uploader_id AS user_id,
            f.name, f.url, f.size, f.mime, f.created_at
       FROM files f
       LEFT JOIN issue_attachments ia ON ia.file_id = f.id
       LEFT JOIN comment_attachments ca ON ca.file_id = f.id
      WHERE f.workspace_id = ?
      ORDER BY f.created_at`,
    workspace.id,
  );
  const attachmentMap = new Map<string, Attachment>();
  for (const attachment of rawAttachments) {
    const issueId = attachment.issue_id && issueIdSet.has(attachment.issue_id) ? attachment.issue_id : null;
    const commentId =
      attachment.comment_id && commentIdSet.has(attachment.comment_id) ? attachment.comment_id : null;
    if (!issueId && !commentId) continue;
    const previous = attachmentMap.get(attachment.id);
    attachmentMap.set(attachment.id, {
      id: attachment.id,
      issueId: previous?.issueId ?? issueId,
      commentId: previous?.commentId ?? commentId,
      userId: attachment.user_id,
      name: attachment.name,
      url: attachment.url,
      size: attachment.size,
      mime: attachment.mime,
      createdAt: attachment.created_at,
    });
  }
  const attachments = [...attachmentMap.values()];

  const accessibleProjectIds = getAll<{ id: string }>(
    `SELECT DISTINCT p.id
      FROM projects p
       LEFT JOIN project_teams pt ON pt.project_id = p.id
      WHERE p.workspace_id = ?
        AND p.archived_at IS NULL
        AND p.trashed_at IS NULL
        AND (
          pt.team_id IN (${teamSlots}) OR
          (? <> 'guest' AND NOT EXISTS (SELECT 1 FROM project_teams none WHERE none.project_id = p.id))
        )
      ORDER BY p.sort_order, p.id`,
    workspace.id,
    ...teamIds,
    context.membership_role,
  ).map((row) => row.id);
  const projectIdSet = new Set(accessibleProjectIds);
  const projectSlots = placeholders(accessibleProjectIds);

  const projectRows = getAll<ProjectRow>(
    `SELECT p.id, p.workspace_id AS workspaceId, p.team_id AS teamId,
            p.name, p.slug, p.summary, p.description, p.status, p.priority,
            p.lead_id AS leadId, p.color, p.icon, p.start_date AS startDate,
            p.target_date AS targetDate, p.archived_at AS archivedAt,
            p.created_at AS createdAt, p.updated_at AS updatedAt,
            COALESCE((SELECT json_group_array(pt.team_id) FROM project_teams pt WHERE pt.project_id = p.id), '[]') AS team_ids_json,
            COALESCE((SELECT json_group_array(pm.user_id) FROM project_members pm WHERE pm.project_id = p.id), '[]') AS member_ids_json
       FROM projects p
      WHERE p.id IN (${projectSlots})
      ORDER BY p.sort_order, p.name COLLATE NOCASE`,
    ...accessibleProjectIds,
  );
  const projects: Project[] = projectRows.map((project) => {
    const result: Project = {
      ...project,
      teamId: project.teamId && teamIdSet.has(project.teamId) ? project.teamId : null,
      priority: project.priority as Project["priority"],
      teamIds: parseJson<string[]>(project.team_ids_json, []).filter((id) => teamIdSet.has(id)),
      memberIds: parseJson<string[]>(project.member_ids_json, []),
    };
    delete (result as Partial<ProjectRow>).team_ids_json;
    delete (result as Partial<ProjectRow>).member_ids_json;
    return result;
  });

  const milestones = getAll<ProjectMilestone>(
    `SELECT id, project_id AS projectId, name, description, target_date AS targetDate,
            position, created_at AS createdAt
       FROM project_milestones
      WHERE project_id IN (${projectSlots})
      ORDER BY project_id, position`,
    ...accessibleProjectIds,
  );
  const projectUpdates = getAll<ProjectUpdate>(
    `SELECT id, project_id AS projectId, author_id AS authorId, health, body, created_at AS createdAt
       FROM project_updates
      WHERE project_id IN (${projectSlots})
      ORDER BY created_at DESC`,
    ...accessibleProjectIds,
  );
  const projectDependencies = getAll<ProjectDependency>(
    `SELECT id, project_id AS projectId, depends_on_project_id AS dependsOnProjectId,
            created_at AS createdAt
       FROM project_dependencies
      WHERE project_id IN (${projectSlots}) AND depends_on_project_id IN (${projectSlots})
      ORDER BY created_at`,
    ...accessibleProjectIds,
    ...accessibleProjectIds,
  );

  const cycles = getAll<Cycle>(
    `SELECT id, team_id AS teamId, number, name, description, start_date AS startDate,
            end_date AS endDate, status, created_at AS createdAt
       FROM cycles
      WHERE team_id IN (${teamSlots})
      ORDER BY start_date DESC`,
    ...teamIds,
  );
  const cycleIdSet = new Set(cycles.map((cycle) => cycle.id));

  const initiativeRows = isGuest
    ? []
    : getAll<InitiativeRow>(
        `SELECT i.id, i.workspace_id AS workspaceId, i.parent_id AS parentId,
                i.name, i.summary, i.description, i.status, i.priority,
                i.owner_id AS ownerId, i.target_date AS targetDate, i.color,
                i.created_at AS createdAt,
                COALESCE((SELECT json_group_array(ip.project_id) FROM initiative_projects ip WHERE ip.initiative_id = i.id), '[]') AS project_ids_json
           FROM initiatives i
          WHERE i.workspace_id = ?
          ORDER BY i.sort_order, i.name COLLATE NOCASE`,
        workspace.id,
      );
  const initiatives: Initiative[] = initiativeRows.map((initiative) => {
    const result: Initiative = {
      ...initiative,
      priority: initiative.priority as Initiative["priority"],
      projectIds: parseJson<string[]>(initiative.project_ids_json, []).filter((id) =>
        projectIdSet.has(id),
      ),
    };
    delete (result as Partial<InitiativeRow>).project_ids_json;
    return result;
  });
  const initiativeIdSet = new Set(initiatives.map((initiative) => initiative.id));

  const rawDocuments = getAll<Document>(
    `SELECT id, workspace_id AS workspaceId, project_id AS projectId, title, content,
            creator_id AS creatorId, created_at AS createdAt, updated_at AS updatedAt
       FROM documents
      WHERE workspace_id = ?
      ORDER BY updated_at DESC`,
    workspace.id,
  );
  const documents = rawDocuments.filter(
    (document) =>
      (document.projectId !== null && projectIdSet.has(document.projectId)) ||
      (document.projectId === null && !isGuest),
  );
  const documentIdSet = new Set(documents.map((document) => document.id));

  const preliminaryUserIds = new Set<string>([userId]);
  for (const member of teamMembers) preliminaryUserIds.add(member.userId);
  for (const issue of issues) {
    preliminaryUserIds.add(issue.creatorId);
    if (issue.assigneeId) preliminaryUserIds.add(issue.assigneeId);
    for (const subscriberId of issue.subscriberIds) preliminaryUserIds.add(subscriberId);
  }
  for (const comment of comments) preliminaryUserIds.add(comment.authorId);
  for (const reaction of reactions) preliminaryUserIds.add(reaction.userId);
  for (const attachment of attachments) preliminaryUserIds.add(attachment.userId);
  for (const project of projects) {
    if (project.leadId) preliminaryUserIds.add(project.leadId);
    for (const memberId of project.memberIds) preliminaryUserIds.add(memberId);
  }
  for (const update of projectUpdates) preliminaryUserIds.add(update.authorId);
  for (const initiative of initiatives) if (initiative.ownerId) preliminaryUserIds.add(initiative.ownerId);
  for (const document of documents) preliminaryUserIds.add(document.creatorId);
  if (!isGuest) for (const membership of allMemberships) preliminaryUserIds.add(membership.userId);

  const rawViews = getAll<ViewRow>(
    `SELECT v.id, v.workspace_id AS workspaceId, v.creator_id AS creatorId,
            v.name, v.description, v.icon, v.color, v.filters_json,
            v.layout, v.is_shared, v.created_at AS createdAt, v.updated_at AS updatedAt
       FROM saved_views v
      WHERE v.workspace_id = ?
        AND (
          v.creator_id = ? OR v.is_shared = 1 OR
          EXISTS (SELECT 1 FROM view_members vm WHERE vm.view_id = v.id AND vm.user_id = ?)
        )
      ORDER BY v.name COLLATE NOCASE`,
    workspace.id,
    userId,
    userId,
  );
  const viewAccess = {
    teamIds: teamIdSet,
    stateIds: stateIdSet,
    labelIds: labelIdSet,
    projectIds: projectIdSet,
    cycleIds: cycleIdSet,
    userIds: preliminaryUserIds,
  };
  const views: SavedView[] = rawViews.flatMap((view) => {
    const filters = sanitizeViewFilters(parseJson<ViewFilters>(view.filters_json, {}), viewAccess);
    if (!filters) return [];
    preliminaryUserIds.add(view.creatorId);
    return [
      {
        id: view.id,
        workspaceId: view.workspaceId,
        creatorId: view.creatorId,
        name: view.name,
        description: view.description,
        icon: view.icon,
        color: view.color,
        filters,
        layout: view.layout,
        isShared: Boolean(view.is_shared),
        createdAt: view.createdAt,
        updatedAt: view.updatedAt,
      },
    ];
  });
  const viewIdSet = new Set(views.map((view) => view.id));

  const visibleMemberships = isGuest
    ? allMemberships.filter((membership) => preliminaryUserIds.has(membership.userId))
    : allMemberships;
  const visibleMembershipIdSet = new Set(visibleMemberships.map((membership) => membership.id));

  const visibleEntities = {
    issues: issueIdSet,
    comments: commentIdSet,
    projects: projectIdSet,
    cycles: cycleIdSet,
    initiatives: initiativeIdSet,
    documents: documentIdSet,
    views: viewIdSet,
    teams: teamIdSet,
    members: visibleMembershipIdSet,
  };

  const activities = getAll<ActivityRow>(
    `SELECT id, workspace_id AS workspaceId, entity_type AS entityType,
            entity_id AS entityId, actor_id AS actorId, action,
            metadata_json, created_at AS createdAt
       FROM activities
      WHERE workspace_id = ?
      ORDER BY created_at DESC`,
    workspace.id,
  )
    .filter((activity) =>
      entityIsVisible(activity.entityType, activity.entityId, visibleEntities),
    )
    .map<Activity>((activity) => ({
      id: activity.id,
      workspaceId: activity.workspaceId,
      entityType: activity.entityType,
      entityId: activity.entityId,
      actorId: activity.actorId,
      action: activity.action,
      metadata: parseJson<Record<string, unknown>>(activity.metadata_json, {}),
      createdAt: activity.createdAt,
    }));
  for (const activity of activities) preliminaryUserIds.add(activity.actorId);

  const favorites = getAll<Favorite>(
    `SELECT id, user_id AS userId, workspace_id AS workspaceId,
            entity_type AS entityType, entity_id AS entityId, position
       FROM favorites
      WHERE workspace_id = ? AND user_id = ?
      ORDER BY position`,
    workspace.id,
    userId,
  ).filter((favorite) =>
    entityIsVisible(favorite.entityType, favorite.entityId, visibleEntities),
  );

  const notifications = getAll<Notification>(
    `SELECT id, user_id AS userId, workspace_id AS workspaceId, type, title, body,
            entity_type AS entityType, entity_id AS entityId, read_at AS readAt,
            snoozed_until AS snoozedUntil, created_at AS createdAt
       FROM notifications
      WHERE workspace_id = ? AND user_id = ? AND archived_at IS NULL
      ORDER BY created_at DESC`,
    workspace.id,
    userId,
  ).filter((notification) =>
    entityIsVisible(notification.entityType, notification.entityId, visibleEntities),
  );
  const notificationPreferences: NotificationPreferences = {
    assigned: true,
    mentioned: true,
    subscribed: true,
    projectUpdates: true,
  };
  const preferenceRows = getAll<{ eventType: keyof NotificationPreferences; enabled: number }>(
    `SELECT event_type AS eventType, enabled
       FROM notification_preferences
      WHERE workspace_id = ? AND user_id = ? AND channel = 'inbox'`,
    workspace.id,
    userId,
  );
  for (const preference of preferenceRows) {
    if (preference.eventType in notificationPreferences) {
      notificationPreferences[preference.eventType] = Boolean(preference.enabled);
    }
  }

  const templateRows = getAll<TemplateRow>(
    `SELECT id, workspace_id AS workspaceId, team_id AS teamId, name,
            title_template AS titleTemplate, description_template AS descriptionTemplate,
            defaults_json, sub_issues_json, created_at AS createdAt
       FROM issue_templates
      WHERE workspace_id = ? AND (team_id IS NULL OR team_id IN (${teamSlots}))
      ORDER BY name COLLATE NOCASE`,
    workspace.id,
    ...teamIds,
  );
  const templates: IssueTemplate[] = templateRows.map((template) => ({
    id: template.id,
    workspaceId: template.workspaceId,
    teamId: template.teamId,
    name: template.name,
    titleTemplate: template.titleTemplate,
    descriptionTemplate: template.descriptionTemplate,
    defaults: sanitizeTemplateDefaults(
      parseJson<Partial<Issue>>(template.defaults_json, {}),
      viewAccess,
    ),
    subIssues: parseJson<Array<{ title: string; description: string }>>(
      template.sub_issues_json,
      [],
    ),
    createdAt: template.createdAt,
  }));

  const recurringIssues = getAll<RecurringIssue>(
    `SELECT id, workspace_id AS workspaceId, team_id AS teamId,
            template_id AS templateId, cadence, interval, next_run_at AS nextRunAt,
            timezone, is_active AS isActive
       FROM recurring_issues
      WHERE workspace_id = ? AND team_id IN (${teamSlots})
      ORDER BY next_run_at`,
    workspace.id,
    ...teamIds,
  ).map((recurring) => ({ ...recurring, isActive: Boolean(recurring.isActive) }));

  const apiKeys = getAll<ApiKeySummary>(
    `SELECT id, workspace_id AS workspaceId, user_id AS userId, name, prefix,
            last_used_at AS lastUsedAt, created_at AS createdAt
       FROM api_keys
      WHERE workspace_id = ? AND user_id = ?
      ORDER BY created_at DESC`,
    workspace.id,
    userId,
  );

  const webhooks = isAdmin
    ? getAll<WebhookRow>(
        `SELECT id, workspace_id AS workspaceId, name, url, events_json,
                is_active, signing_secret_encrypted IS NOT NULL AS signing_ready,
                created_at AS createdAt
           FROM webhooks
          WHERE workspace_id = ?
          ORDER BY name COLLATE NOCASE`,
        workspace.id,
      ).map<Webhook>((webhook) => ({
        id: webhook.id,
        workspaceId: webhook.workspaceId,
        name: webhook.name,
        url: webhook.url,
        events: parseJson<string[]>(webhook.events_json, []),
        isActive: Boolean(webhook.is_active),
        signingReady: Boolean(webhook.signing_ready),
        createdAt: webhook.createdAt,
      }))
    : [];

  const data: BootstrapData = {
    currentUser,
    currentMembership,
    workspace,
    memberships: isGuest
      ? allMemberships.filter((membership) => preliminaryUserIds.has(membership.userId))
      : allMemberships,
    teams,
    teamMembers,
    states,
    labels,
    issues,
    relations,
    comments,
    reactions,
    attachments,
    activities,
    projects,
    milestones,
    projectUpdates,
    projectDependencies,
    cycles,
    initiatives,
    views,
    favorites,
    notifications,
    notificationPreferences,
    documents,
    templates,
    recurringIssues,
    apiKeys,
    webhooks,
  };

  // node:sqlite deliberately returns rows with a null prototype. Route handlers
  // can JSON-encode them, but React Server Components only accept plain objects
  // at the client boundary. A single normalization point also proves that the
  // bootstrap contract contains no functions, BigInts, or database row objects.
  return JSON.parse(JSON.stringify(data)) as BootstrapData;
}
