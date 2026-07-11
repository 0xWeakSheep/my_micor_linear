import "server-only";

import { z } from "zod";

import {
  requireTeamPermission,
  requireWorkspacePermission,
} from "@/lib/auth";
import type { BindValue, Database } from "@/lib/db";
import { getDatabase, transaction } from "@/lib/db";
import type {
  ApiKeySummary,
  Document,
  Issue,
  IssueTemplate,
  Label,
  Membership,
  RecurringIssue,
  Team,
  User,
  Webhook,
  WorkflowState,
  Workspace,
  WorkspaceRole,
} from "@/lib/domain";
import {
  createId,
  generateOpaqueToken,
  hashOpaqueToken,
  normalizeEmail,
} from "@/lib/security";
import { sealWebhookSecret } from "@/lib/webhook-secret";
import {
  ConflictError,
  DomainValidationError,
  finishMutation,
  type MutationResult,
  recordAudit,
  ResourceNotFoundError,
} from "@/modules/shared/mutation";

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  icon: string;
  timezone: string;
  created_at: string;
}

interface UserAccountRow {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  preferences_json: string;
  created_at: string;
}

interface MembershipRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  status: Membership["status"];
  joined_at: string;
  name: string;
  email: string;
  avatar_url: string | null;
  user_created_at: string;
}

interface TeamRow {
  id: string;
  workspace_id: string;
  name: string;
  key: string;
  description: string;
  color: string;
  icon: string;
  is_private: number;
  triage_enabled: number;
  created_at: string;
}

interface StateRow {
  id: string;
  team_id: string;
  name: string;
  type: WorkflowState["type"];
  color: string;
  position: number;
  is_default: number;
}

interface LabelRow {
  id: string;
  workspace_id: string;
  team_id: string | null;
  group_id: string | null;
  name: string;
  color: string;
  description: string;
  group_name: string | null;
}

interface DocumentRow {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title: string;
  content: string;
  creator_id: string;
  created_at: string;
  updated_at: string;
}

interface TemplateRow {
  id: string;
  workspace_id: string;
  team_id: string | null;
  name: string;
  title_template: string;
  description_template: string;
  defaults_json: string;
  sub_issues_json: string;
  created_at: string;
}

interface RecurringRow {
  id: string;
  workspace_id: string;
  team_id: string;
  template_id: string;
  cadence: RecurringIssue["cadence"];
  interval: number;
  next_run_at: string;
  timezone: string;
  is_active: number;
}

interface ApiKeyRow {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  created_at: string;
}

interface WebhookRow {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  events_json: string;
  is_active: number;
  created_at: string;
}

export interface InvitationSecretResult {
  invitation: {
    id: string;
    workspaceId: string;
    email: string;
    role: WorkspaceRole;
    expiresAt: string;
    createdAt: string;
  };
  token: string;
}

export interface ApiKeySecretResult {
  apiKey: ApiKeySummary;
  token: string;
}

export interface WebhookSecretResult {
  webhook: Webhook;
  secret?: string;
}

const idSchema = z.string().trim().min(1).max(160);
const nullableIdSchema = idSchema.nullable();
const roleSchema = z.enum(["admin", "member", "guest"]);
const colorSchema = z.string().trim().min(1).max(32);
const iconSchema = z.string().trim().min(1).max(16);
const dateTimeSchema = z
  .string()
  .max(64)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date or time.");
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Invalid timezone.");

const workspaceChangesSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(48)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Workspace slug must use lowercase letters, numbers, and hyphens.")
      .optional(),
    icon: iconSchema.optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict();

const teamChangesSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    key: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(/^[A-Z][A-Z0-9]{1,7}$/, "Team key must contain 2-8 letters or numbers."))
      .optional(),
    description: z.string().max(5_000).optional(),
    color: colorSchema.optional(),
    icon: iconSchema.optional(),
    isPrivate: z.boolean().optional(),
    triageEnabled: z.boolean().optional(),
    members: z
      .array(
        z
          .object({ userId: idSchema, role: z.enum(["lead", "member"]) })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();

const stateChangesSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    type: z.enum(["triage", "backlog", "unstarted", "started", "completed", "canceled"]).optional(),
    color: colorSchema.optional(),
    position: z.number().finite().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

const labelChangesSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    color: colorSchema.optional(),
    description: z.string().max(2_000).optional(),
    groupName: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict();

const documentChangesSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    content: z.string().max(500_000).optional(),
    projectId: nullableIdSchema.optional(),
  })
  .strict();

const templateDefaultsSchema = z
  .object({
    statusId: idSchema.optional(),
    priority: z.number().int().min(0).max(4).optional(),
    assigneeId: nullableIdSchema.optional(),
    projectId: nullableIdSchema.optional(),
    cycleId: nullableIdSchema.optional(),
    estimate: z.number().int().min(0).max(1_000).nullable().optional(),
    dueDate: z.string().max(40).nullable().optional(),
    labelIds: z.array(idSchema).max(50).optional(),
  })
  .strict();

const templateChangesSchema = z
  .object({
    teamId: nullableIdSchema.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    titleTemplate: z.string().max(500).optional(),
    descriptionTemplate: z.string().max(100_000).optional(),
    defaults: templateDefaultsSchema.optional(),
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
  })
  .strict();

const recurringChangesSchema = z
  .object({
    templateId: idSchema.optional(),
    cadence: z.enum(["daily", "weekly", "monthly"]).optional(),
    interval: z.number().int().min(1).max(365).optional(),
    nextRunAt: dateTimeSchema.optional(),
    timezone: timezoneSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const apiScopeSchema = z.enum([
  "workspace:read",
  "issues:read",
  "issues:write",
  "projects:read",
  "projects:write",
  "webhooks:manage",
]);

const webhookEventSchema = z.enum([
  "issue.created",
  "issue.updated",
  "issue.deleted",
  "comment.created",
  "project.created",
  "project.updated",
  "project-update.created",
  "member.updated",
]);

const webhookChangesSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    url: z
      .string()
      .url()
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Webhook URL must use HTTP or HTTPS.")
      .optional(),
    events: z.array(webhookEventSchema).min(1).max(30).optional(),
    isActive: z.boolean().optional(),
    rotateSecret: z.boolean().optional(),
  })
  .strict();

function invalid(parsed: { error: z.ZodError }): never {
  throw new DomainValidationError(parsed.error.issues[0]?.message ?? "Invalid action payload.");
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon,
    timezone: row.timezone,
    createdAt: row.created_at,
  };
}

function toMembership(row: MembershipRow): Membership {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at,
    user: {
      id: row.user_id,
      name: row.name,
      email: row.email,
      avatarUrl: row.avatar_url,
      createdAt: row.user_created_at,
    },
  };
}

function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    key: row.key,
    description: row.description,
    color: row.color,
    icon: row.icon,
    isPrivate: Boolean(row.is_private),
    triageEnabled: Boolean(row.triage_enabled),
    createdAt: row.created_at,
  };
}

function toState(row: StateRow): WorkflowState {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    type: row.type,
    color: row.color,
    position: row.position,
  };
}

function toLabel(row: LabelRow): Label {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    color: row.color,
    description: row.description,
    groupName: row.group_name,
  };
}

function toDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    creatorId: row.creator_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTemplate(row: TemplateRow): IssueTemplate {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    teamId: row.team_id,
    name: row.name,
    titleTemplate: row.title_template,
    descriptionTemplate: row.description_template,
    defaults: parseJson<Partial<Issue>>(row.defaults_json, {}),
    subIssues: parseJson<Array<{ title: string; description: string }>>(row.sub_issues_json, []),
    createdAt: row.created_at,
  };
}

function toRecurring(row: RecurringRow): RecurringIssue {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    teamId: row.team_id,
    templateId: row.template_id,
    cadence: row.cadence,
    interval: row.interval,
    nextRunAt: row.next_run_at,
    timezone: row.timezone,
    isActive: Boolean(row.is_active),
  };
}

function toApiKey(row: ApiKeyRow): ApiKeySummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    name: row.name,
    prefix: row.prefix,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

function toWebhook(row: WebhookRow): Webhook {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    url: row.url,
    events: parseJson<string[]>(row.events_json, []),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

function getWorkspace(database: Database, workspaceId: string): WorkspaceRow {
  const row = database.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as
    | WorkspaceRow
    | undefined;
  if (!row) throw new ResourceNotFoundError("Workspace not found.");
  return row;
}

function getMembership(database: Database, workspaceId: string, selector: { membershipId?: string; userId?: string }): MembershipRow {
  const row = database
    .prepare(
      `SELECT wm.*, u.name, u.email, u.avatar_url, u.created_at AS user_created_at
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = ?
          AND ((? IS NOT NULL AND wm.id = ?) OR (? IS NOT NULL AND wm.user_id = ?))`,
    )
    .get(
      workspaceId,
      selector.membershipId ?? null,
      selector.membershipId ?? null,
      selector.userId ?? null,
      selector.userId ?? null,
    ) as MembershipRow | undefined;
  if (!row) throw new ResourceNotFoundError("Workspace member not found.");
  return row;
}

function getTeam(database: Database, workspaceId: string, teamId: string): TeamRow {
  const row = database
    .prepare("SELECT * FROM teams WHERE id = ? AND workspace_id = ?")
    .get(teamId, workspaceId) as TeamRow | undefined;
  if (!row) throw new ResourceNotFoundError("Team not found.");
  return row;
}

function getState(database: Database, stateId: string): StateRow {
  const row = database.prepare("SELECT * FROM workflow_states WHERE id = ?").get(stateId) as
    | StateRow
    | undefined;
  if (!row) throw new ResourceNotFoundError("Workflow state not found.");
  return row;
}

function getLabel(database: Database, workspaceId: string, labelId: string): LabelRow {
  const row = database
    .prepare(
      `SELECT l.*, lg.name AS group_name
         FROM labels l LEFT JOIN label_groups lg ON lg.id = l.group_id
        WHERE l.id = ? AND l.workspace_id = ?`,
    )
    .get(labelId, workspaceId) as LabelRow | undefined;
  if (!row) throw new ResourceNotFoundError("Label not found.");
  return row;
}

function getDocument(database: Database, workspaceId: string, documentId: string): DocumentRow {
  const row = database
    .prepare("SELECT * FROM documents WHERE id = ? AND workspace_id = ?")
    .get(documentId, workspaceId) as DocumentRow | undefined;
  if (!row) throw new ResourceNotFoundError("Document not found.");
  return row;
}

function getTemplate(database: Database, workspaceId: string, templateId: string): TemplateRow {
  const row = database
    .prepare("SELECT * FROM issue_templates WHERE id = ? AND workspace_id = ?")
    .get(templateId, workspaceId) as TemplateRow | undefined;
  if (!row) throw new ResourceNotFoundError("Issue template not found.");
  return row;
}

function getRecurring(database: Database, workspaceId: string, recurringId: string): RecurringRow {
  const row = database
    .prepare("SELECT * FROM recurring_issues WHERE id = ? AND workspace_id = ?")
    .get(recurringId, workspaceId) as RecurringRow | undefined;
  if (!row) throw new ResourceNotFoundError("Recurring issue not found.");
  return row;
}

function getWebhook(database: Database, workspaceId: string, webhookId: string): WebhookRow {
  const row = database
    .prepare("SELECT * FROM webhooks WHERE id = ? AND workspace_id = ?")
    .get(webhookId, workspaceId) as WebhookRow | undefined;
  if (!row) throw new ResourceNotFoundError("Webhook not found.");
  return row;
}

function ensureWorkspaceMember(database: Database, workspaceId: string, userId: string): void {
  const found = database
    .prepare(
      "SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND status = 'active'",
    )
    .get(workspaceId, userId);
  if (!found) throw new DomainValidationError("Team members must be active workspace members.");
}

function ensureTeamScope(workspaceId: string, actorId: string, teamId: string | null): void {
  if (teamId) {
    const context = requireTeamPermission(actorId, teamId, "manage");
    if (context.workspaceId !== workspaceId) throw new ResourceNotFoundError();
  } else {
    requireWorkspacePermission(actorId, workspaceId, "manage_settings");
  }
}

function findOrCreateLabelGroup(
  database: Database,
  workspaceId: string,
  groupName: string | null | undefined,
  now: string,
): string | null | undefined {
  if (groupName === undefined) return undefined;
  if (groupName === null) return null;
  const existing = database
    .prepare("SELECT id FROM label_groups WHERE workspace_id = ? AND name = ? COLLATE NOCASE")
    .get(workspaceId, groupName) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = createId("labelgroup");
  database
    .prepare("INSERT INTO label_groups(id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, workspaceId, groupName, now);
  return id;
}

function finishAdministrativeMutation(
  database: Database,
  input: {
    workspaceId: string;
    actorId: string;
    entityType: string;
    entityId: string;
    eventType: string;
    action: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
  },
): void {
  finishMutation(database, input);
  recordAudit(database, {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata,
    createdAt: input.createdAt,
  });
}

function applyScalarChanges<T extends Record<string, unknown>>(
  database: Database,
  table: string,
  id: string,
  changes: T,
  mapping: Partial<Record<keyof T, string>>,
  now?: string,
): void {
  const sets: string[] = [];
  const values: BindValue[] = [];
  for (const [key, column] of Object.entries(mapping) as Array<[keyof T, string]>) {
    const value = changes[key];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      values.push(typeof value === "boolean" ? (value ? 1 : 0) : (value as BindValue));
    }
  }
  if (sets.length === 0 && !now) return;
  if (now) {
    sets.push("updated_at = ?");
    values.push(now);
  }
  values.push(id);
  database.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

function updateAccount(
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<User> {
  const context = requireWorkspacePermission(actorId, workspaceId, "read");
  const parsed = z.object({
    changes: z.object({
      name: z.string().trim().min(1).max(100).optional(),
      email: z.string().trim().email().max(254).optional(),
      theme: z.enum(["light", "dark", "system"]).optional(),
      compactRows: z.boolean().optional(),
    }).strict(),
  }).strict().safeParse(payload);
  if (!parsed.success) invalid(parsed);
  if (Object.keys(parsed.data.changes).length === 0) throw new DomainValidationError("No account changes supplied.");
  const now = new Date().toISOString();
  const data = transaction((database) => {
    const current = database.prepare(
      "SELECT id, name, email, avatar_url, preferences_json, created_at FROM users WHERE id = ? AND disabled_at IS NULL",
    ).get(actorId) as UserAccountRow | undefined;
    if (!current) throw new ResourceNotFoundError("Account not found.");
    const email = parsed.data.changes.email ? normalizeEmail(parsed.data.changes.email) : current.email;
    if (email !== current.email && database.prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND id <> ?").get(email, actorId)) {
      throw new ConflictError("This email address is already in use.");
    }
    const preferences = parseJson<Record<string, unknown>>(current.preferences_json, {});
    if (parsed.data.changes.theme !== undefined) preferences.theme = parsed.data.changes.theme;
    if (parsed.data.changes.compactRows !== undefined) preferences.compactRows = parsed.data.changes.compactRows;
    database.prepare(
      "UPDATE users SET name = ?, email = ?, preferences_json = ?, updated_at = ? WHERE id = ?",
    ).run(parsed.data.changes.name ?? current.name, email, JSON.stringify(preferences), now, actorId);
    finishAdministrativeMutation(database, {
      workspaceId,
      actorId,
      entityType: "member",
      entityId: context.membershipId,
      eventType: "account.updated",
      action: "account.updated",
      metadata: { fields: Object.keys(parsed.data.changes) },
      createdAt: now,
    });
    const updated = database.prepare(
      "SELECT id, name, email, avatar_url, preferences_json, created_at FROM users WHERE id = ?",
    ).get(actorId) as unknown as UserAccountRow;
    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      avatarUrl: updated.avatar_url,
      createdAt: updated.created_at,
    };
  });
  return { data, eventType: "account.updated", resourceId: actorId };
}

function updateWorkspace(
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<Workspace> {
  requireWorkspacePermission(actorId, workspaceId, "manage_settings");
  const parsed = z
    .union([
      workspaceChangesSchema,
      z.object({ workspaceId: idSchema.optional(), changes: workspaceChangesSchema }).strict(),
    ])
    .safeParse(payload);
  if (!parsed.success) invalid(parsed);
  const changes = "changes" in parsed.data ? parsed.data.changes : parsed.data;
  if ("workspaceId" in parsed.data && parsed.data.workspaceId && parsed.data.workspaceId !== workspaceId) {
    throw new ResourceNotFoundError("Workspace not found.");
  }
  if (Object.keys(changes).length === 0) throw new DomainValidationError("No workspace changes supplied.");
  const now = new Date().toISOString();
  const data = transaction((database) => {
    const current = getWorkspace(database, workspaceId);
    if (
      changes.slug &&
      database.prepare("SELECT 1 FROM workspaces WHERE slug = ? COLLATE NOCASE AND id <> ?").get(changes.slug, workspaceId)
    ) {
      throw new ConflictError("Workspace URL is already in use.");
    }
    applyScalarChanges(database, "workspaces", current.id, changes, {
      name: "name",
      slug: "slug",
      icon: "icon",
      timezone: "timezone",
    }, now);
    finishAdministrativeMutation(database, {
      workspaceId, actorId, entityType: "workspace", entityId: workspaceId,
      eventType: "workspace.updated", action: "workspace.updated",
      metadata: { fields: Object.keys(changes) }, createdAt: now,
    });
    return toWorkspace(getWorkspace(database, workspaceId));
  });
  return { data, eventType: "workspace.updated", resourceId: workspaceId };
}

function inviteMember(
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<InvitationSecretResult> {
  requireWorkspacePermission(actorId, workspaceId, "manage_members");
  const parsed = z.object({
    email: z.string().trim().email().max(254),
    role: roleSchema.default("member"),
    expiresInDays: z.number().int().min(1).max(30).default(7),
  }).strict().safeParse(payload);
  if (!parsed.success) invalid(parsed);
  const email = normalizeEmail(parsed.data.email);
  const token = `inv_${generateOpaqueToken()}`;
  const tokenHash = hashOpaqueToken(token);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 86_400_000).toISOString();
  const data = transaction((database) => {
    const membershipCount = database
      .prepare("SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ?")
      .get(workspaceId) as { count: number };
    if (Number(membershipCount.count) >= 100) {
      throw new ConflictError("This workspace has reached its 100-member limit.");
    }
    const member = database.prepare(
      `SELECT 1 FROM workspace_members wm JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = ? AND u.email = ? COLLATE NOCASE`,
    ).get(workspaceId, email);
    if (member) throw new ConflictError("This person is already a workspace member.");
    const existing = database.prepare(
      "SELECT id, created_at FROM invitations WHERE workspace_id = ? AND email = ? COLLATE NOCASE",
    ).get(workspaceId, email) as { id: string; created_at: string } | undefined;
    const id = existing?.id ?? createId("invite");
    const createdAt = existing?.created_at ?? now;
    if (existing) {
      database.prepare(
        `UPDATE invitations SET role = ?, token_hash = ?, invited_by_id = ?,
          expires_at = ?, accepted_by_id = NULL, accepted_at = NULL WHERE id = ?`,
      ).run(parsed.data.role, tokenHash, actorId, expiresAt, id);
    } else {
      database.prepare(
        `INSERT INTO invitations(id, workspace_id, email, role, token_hash, invited_by_id,
          expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, workspaceId, email, parsed.data.role, tokenHash, actorId, expiresAt, now);
    }
    finishAdministrativeMutation(database, {
      workspaceId, actorId, entityType: "member", entityId: id,
      eventType: "member.invited", action: "member.invited",
      metadata: { email, role: parsed.data.role }, createdAt: now,
    });
    return {
      invitation: { id, workspaceId, email, role: parsed.data.role, expiresAt, createdAt },
      token,
    };
  });
  return { data, eventType: "member.invited", resourceId: data.invitation.id };
}

function updateMember(
  action: string,
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<Membership> {
  requireWorkspacePermission(actorId, workspaceId, "manage_members");
  const parsed = z.object({
    membershipId: idSchema.optional(),
    memberId: idSchema.optional(),
    userId: idSchema.optional(),
    changes: z.object({ role: roleSchema.optional(), status: z.enum(["active", "suspended"]).optional() }).strict().default({}),
    suspend: z.boolean().optional(),
    suspended: z.boolean().optional(),
  }).strict().refine((value) => Boolean(value.membershipId || value.memberId || value.userId), "Member id is required.").safeParse(payload);
  if (!parsed.success) invalid(parsed);
  const data = transaction((database) => {
    const current = getMembership(database, workspaceId, {
      membershipId: parsed.data.membershipId ?? parsed.data.memberId,
      userId: parsed.data.userId,
    });
    const changes = {
      ...parsed.data.changes,
      ...(action === "member.suspend" ? {
        status: (parsed.data.suspend ?? parsed.data.suspended) === false ? "active" as const : "suspended" as const,
      } : {}),
    };
    if (Object.keys(changes).length === 0) throw new DomainValidationError("No member changes supplied.");
    const nextRole = changes.role ?? current.role;
    const nextStatus = changes.status ?? current.status;
    if (current.user_id === actorId && nextStatus === "suspended") {
      throw new ConflictError("You cannot suspend your own account.");
    }
    if (current.role === "admin" && current.status === "active" && (nextRole !== "admin" || nextStatus !== "active")) {
      const admins = database.prepare(
        "SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ? AND role = 'admin' AND status = 'active'",
      ).get(workspaceId) as { count: number };
      if (Number(admins.count) <= 1) throw new ConflictError("A workspace must retain an active admin.");
    }
    const now = new Date().toISOString();
    database.prepare("UPDATE workspace_members SET role = ?, status = ? WHERE id = ?")
      .run(nextRole, nextStatus, current.id);
    finishAdministrativeMutation(database, {
      workspaceId, actorId, entityType: "member", entityId: current.id,
      eventType: "member.updated", action: action === "member.suspend" ? "member.suspended" : "member.updated",
      metadata: { role: nextRole, status: nextStatus }, createdAt: now,
    });
    return toMembership(getMembership(database, workspaceId, { membershipId: current.id }));
  });
  return { data, eventType: "member.updated", resourceId: data.id };
}

function createTeam(
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<Team> {
  requireWorkspacePermission(actorId, workspaceId, "create_team");
  const parsed = teamChangesSchema.extend({
    name: z.string().trim().min(1).max(100),
    key: z.string().trim().transform((value) => value.toUpperCase()).pipe(z.string().regex(/^[A-Z][A-Z0-9]{1,7}$/)),
  }).safeParse(payload);
  if (!parsed.success) invalid(parsed);
  const now = new Date().toISOString();
  const id = createId("team");
  const data = transaction((database) => {
    if (database.prepare("SELECT 1 FROM teams WHERE workspace_id = ? AND (key = ? COLLATE NOCASE OR name = ? COLLATE NOCASE)").get(workspaceId, parsed.data.key, parsed.data.name)) {
      throw new ConflictError("A team already uses this name or key.");
    }
    database.prepare(
      `INSERT INTO teams(id, workspace_id, name, key, description, color, icon, is_private,
        triage_enabled, next_issue_number, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(id, workspaceId, parsed.data.name, parsed.data.key, parsed.data.description ?? "",
      parsed.data.color ?? "#5E6AD2", parsed.data.icon ?? parsed.data.key[0]!,
      parsed.data.isPrivate ? 1 : 0, parsed.data.triageEnabled ? 1 : 0, now, now);
    const members = new Map((parsed.data.members ?? []).map((member) => [member.userId, member.role]));
    members.set(actorId, "lead");
    const insertMember = database.prepare("INSERT INTO team_members(team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)");
    for (const [userId, role] of members) {
      ensureWorkspaceMember(database, workspaceId, userId);
      insertMember.run(id, userId, role, now);
    }
    const defaults = [
      ...(parsed.data.triageEnabled ? [["Triage", "triage", "#8B8D98", 0, 0]] : []),
      ["Backlog", "backlog", "#6B7280", 100, 1], ["Todo", "unstarted", "#E2B340", 200, 0],
      ["In Progress", "started", "#5E6AD2", 300, 0], ["Done", "completed", "#5EBD8C", 400, 0],
      ["Canceled", "canceled", "#9CA3AF", 500, 0],
    ] as Array<[string, WorkflowState["type"], string, number, number]>;
    const insertState = database.prepare(
      "INSERT INTO workflow_states(id, team_id, name, type, color, position, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const [name, type, color, position, isDefault] of defaults) {
      insertState.run(createId("state"), id, name, type, color, position, isDefault, now);
    }
    finishAdministrativeMutation(database, {
      workspaceId, actorId, entityType: "team", entityId: id,
      eventType: "team.created", action: "team.created", metadata: { name: parsed.data.name, key: parsed.data.key }, createdAt: now,
    });
    return toTeam(getTeam(database, workspaceId, id));
  });
  return { data, eventType: "team.created", resourceId: id };
}

function updateTeam(
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<Team> {
  const parsed = z.object({ teamId: idSchema, changes: teamChangesSchema }).strict().safeParse(payload);
  if (!parsed.success) invalid(parsed);
  const current = getTeam(getDatabase(), workspaceId, parsed.data.teamId);
  const access = requireTeamPermission(actorId, current.id, "manage");
  if (access.workspaceId !== workspaceId) throw new ResourceNotFoundError();
  const now = new Date().toISOString();
  const data = transaction((database) => {
    if ((parsed.data.changes.key || parsed.data.changes.name) && database.prepare(
      `SELECT 1 FROM teams WHERE workspace_id = ? AND id <> ?
       AND (key = ? COLLATE NOCASE OR name = ? COLLATE NOCASE)`,
    ).get(workspaceId, current.id, parsed.data.changes.key ?? current.key, parsed.data.changes.name ?? current.name)) {
      throw new ConflictError("A team already uses this name or key.");
    }
    if (parsed.data.changes.key && parsed.data.changes.key !== current.key) {
      const issueCount = database.prepare("SELECT COUNT(*) AS count FROM issues WHERE team_id = ?").get(current.id) as { count: number };
      if (Number(issueCount.count) > 0) {
        throw new ConflictError("Team keys cannot be changed after issues have been created.");
      }
    }
    applyScalarChanges(database, "teams", current.id, parsed.data.changes, {
      name: "name", key: "key", description: "description", color: "color", icon: "icon",
      isPrivate: "is_private", triageEnabled: "triage_enabled",
    }, now);
    if (parsed.data.changes.triageEnabled === true && !current.triage_enabled) {
      const existingTriage = database
        .prepare("SELECT 1 FROM workflow_states WHERE team_id = ? AND type = 'triage'")
        .get(current.id);
      if (!existingTriage) {
        database
          .prepare(
            "INSERT INTO workflow_states(id, team_id, name, type, color, position, is_default, created_at) VALUES (?, ?, 'Triage', 'triage', '#8B8D98', 0, 0, ?)",
          )
          .run(createId("state"), current.id, now);
      }
    }
    if (parsed.data.changes.members) {
      if (!parsed.data.changes.members.some((member) => member.role === "lead")) {
        throw new DomainValidationError("A team must have at least one lead.");
      }
      database.prepare("DELETE FROM team_members WHERE team_id = ?").run(current.id);
      const insert = database.prepare("INSERT INTO team_members(team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)");
      for (const member of parsed.data.changes.members) {
        ensureWorkspaceMember(database, workspaceId, member.userId);
        insert.run(current.id, member.userId, member.role, now);
      }
    }
    finishAdministrativeMutation(database, {
      workspaceId, actorId, entityType: "team", entityId: current.id,
      eventType: "team.updated", action: "team.updated", metadata: { fields: Object.keys(parsed.data.changes) }, createdAt: now,
    });
    return toTeam(getTeam(database, workspaceId, current.id));
  });
  return { data, eventType: "team.updated", resourceId: current.id };
}

function executeStateAction(
  action: string,
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<WorkflowState | boolean> {
  if (action === "workflowState.create") {
    const parsed = stateChangesSchema.extend({ teamId: idSchema, name: z.string().trim().min(1).max(100), type: z.enum(["triage", "backlog", "unstarted", "started", "completed", "canceled"]) }).safeParse(payload);
    if (!parsed.success) invalid(parsed);
    const access = requireTeamPermission(actorId, parsed.data.teamId, "manage");
    if (access.workspaceId !== workspaceId) throw new ResourceNotFoundError();
    const id = createId("state");
    const now = new Date().toISOString();
    const data = transaction((database) => {
      getTeam(database, workspaceId, parsed.data.teamId);
      const position = parsed.data.position ?? Number((database.prepare("SELECT COALESCE(MAX(position), 0) + 100 AS value FROM workflow_states WHERE team_id = ?").get(parsed.data.teamId) as { value: number }).value);
      if (parsed.data.isDefault) database.prepare("UPDATE workflow_states SET is_default = 0 WHERE team_id = ?").run(parsed.data.teamId);
      database.prepare("INSERT INTO workflow_states(id, team_id, name, type, color, position, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, parsed.data.teamId, parsed.data.name, parsed.data.type, parsed.data.color ?? "#8B8D98", position, parsed.data.isDefault ? 1 : 0, now);
      finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "team", entityId: parsed.data.teamId, eventType: "workflowState.created", action: "workflowState.created", metadata: { stateId: id }, createdAt: now });
      return toState(getState(database, id));
    });
    return { data, eventType: "workflowState.created", resourceId: id };
  }
  const parsed = z.object({ stateId: idSchema, changes: stateChangesSchema.optional() }).strict().safeParse(payload);
  if (!parsed.success) invalid(parsed);
  const current = getState(getDatabase(), parsed.data.stateId);
  const team = getTeam(getDatabase(), workspaceId, current.team_id);
  const access = requireTeamPermission(actorId, team.id, "manage");
  if (access.workspaceId !== workspaceId) throw new ResourceNotFoundError();
  const now = new Date().toISOString();
  if (action === "workflowState.delete") {
    const data = transaction((database) => {
      const used = database.prepare("SELECT 1 FROM issues WHERE status_id = ? LIMIT 1").get(current.id);
      if (used) throw new ConflictError("Move issues to another state before deleting this state.");
      const count = database.prepare("SELECT COUNT(*) AS count FROM workflow_states WHERE team_id = ?").get(team.id) as { count: number };
      if (Number(count.count) <= 1) throw new ConflictError("A team must retain a workflow state.");
      database.prepare("DELETE FROM workflow_states WHERE id = ?").run(current.id);
      if (current.is_default) database.prepare("UPDATE workflow_states SET is_default = 1 WHERE id = (SELECT id FROM workflow_states WHERE team_id = ? ORDER BY position LIMIT 1)").run(team.id);
      finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "team", entityId: team.id, eventType: "workflowState.deleted", action: "workflowState.deleted", metadata: { stateId: current.id }, createdAt: now });
      return true;
    });
    return { data, eventType: "workflowState.deleted", resourceId: current.id };
  }
  const changes = parsed.data.changes ?? {};
  const data = transaction((database) => {
    if (changes.isDefault) database.prepare("UPDATE workflow_states SET is_default = 0 WHERE team_id = ?").run(team.id);
    applyScalarChanges(database, "workflow_states", current.id, changes, { name: "name", type: "type", color: "color", position: "position", isDefault: "is_default" });
    finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "team", entityId: team.id, eventType: "workflowState.updated", action: "workflowState.updated", metadata: { stateId: current.id, fields: Object.keys(changes) }, createdAt: now });
    return toState(getState(database, current.id));
  });
  return { data, eventType: "workflowState.updated", resourceId: current.id };
}

function executeLabelAction(action: string, workspaceId: string, actorId: string, payload: unknown): MutationResult<Label | boolean> {
  if (action === "label.create") {
    const parsed = labelChangesSchema.extend({ name: z.string().trim().min(1).max(100), teamId: nullableIdSchema.optional() }).safeParse(payload);
    if (!parsed.success) invalid(parsed);
    ensureTeamScope(workspaceId, actorId, parsed.data.teamId ?? null);
    const now = new Date().toISOString();
    const id = createId("label");
    const data = transaction((database) => {
      const duplicate = database.prepare(`SELECT 1 FROM labels WHERE workspace_id = ? AND name = ? COLLATE NOCASE AND ((team_id IS NULL AND ? IS NULL) OR team_id = ?)`).get(workspaceId, parsed.data.name, parsed.data.teamId ?? null, parsed.data.teamId ?? null);
      if (duplicate) throw new ConflictError("A label with this name already exists in this scope.");
      const groupId = findOrCreateLabelGroup(database, workspaceId, parsed.data.groupName, now) ?? null;
      database.prepare(`INSERT INTO labels(id, workspace_id, team_id, group_id, name, color, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, workspaceId, parsed.data.teamId ?? null, groupId, parsed.data.name, parsed.data.color ?? "#8B8D98", parsed.data.description ?? "", now);
      finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "label", entityId: id, eventType: "label.created", action: "label.created", metadata: { teamId: parsed.data.teamId ?? null, name: parsed.data.name }, createdAt: now });
      return toLabel(getLabel(database, workspaceId, id));
    });
    return { data, eventType: "label.created", resourceId: id };
  }
  const parsed = z.object({ labelId: idSchema, changes: labelChangesSchema.optional() }).strict().safeParse(payload);
  if (!parsed.success) invalid(parsed);
  const current = getLabel(getDatabase(), workspaceId, parsed.data.labelId);
  ensureTeamScope(workspaceId, actorId, current.team_id);
  const now = new Date().toISOString();
  if (action === "label.delete") {
    const data = transaction((database) => {
      database.prepare("DELETE FROM labels WHERE id = ?").run(current.id);
      finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "label", entityId: current.id, eventType: "label.deleted", action: "label.deleted", createdAt: now });
      return true;
    });
    return { data, eventType: "label.deleted", resourceId: current.id };
  }
  const changes = parsed.data.changes ?? {};
  const data = transaction((database) => {
    const groupId = findOrCreateLabelGroup(database, workspaceId, changes.groupName, now);
    applyScalarChanges(database, "labels", current.id, changes, { name: "name", color: "color", description: "description" });
    if (groupId !== undefined) database.prepare("UPDATE labels SET group_id = ? WHERE id = ?").run(groupId, current.id);
    finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "label", entityId: current.id, eventType: "label.updated", action: "label.updated", metadata: { fields: Object.keys(changes) }, createdAt: now });
    return toLabel(getLabel(database, workspaceId, current.id));
  });
  return { data, eventType: "label.updated", resourceId: current.id };
}

function ensureProjectForDocument(database: Database, workspaceId: string, projectId: string | null | undefined): void {
  if (!projectId) return;
  if (!database.prepare("SELECT 1 FROM projects WHERE id = ? AND workspace_id = ? AND trashed_at IS NULL").get(projectId, workspaceId)) {
    throw new ResourceNotFoundError("Project not found.");
  }
}

function executeDocumentAction(action: string, workspaceId: string, actorId: string, payload: unknown): MutationResult<Document | boolean> {
  requireWorkspacePermission(actorId, workspaceId, "create_project");
  if (action === "document.create") {
    const parsed = documentChangesSchema.extend({ title: z.string().trim().min(1).max(300) }).safeParse(payload);
    if (!parsed.success) invalid(parsed);
    const id = createId("doc"); const now = new Date().toISOString();
    const data = transaction((database) => {
      ensureProjectForDocument(database, workspaceId, parsed.data.projectId);
      database.prepare(`INSERT INTO documents(id, workspace_id, project_id, title, content, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, workspaceId, parsed.data.projectId ?? null, parsed.data.title, parsed.data.content ?? "", actorId, now, now);
      finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "document", entityId: id, eventType: "document.created", action: "document.created", metadata: { projectId: parsed.data.projectId ?? null, title: parsed.data.title }, createdAt: now });
      return toDocument(getDocument(database, workspaceId, id));
    });
    return { data, eventType: "document.created", resourceId: id };
  }
  const parsed = z.object({ documentId: idSchema, changes: documentChangesSchema.optional() }).strict().safeParse(payload);
  if (!parsed.success) invalid(parsed);
  const current = getDocument(getDatabase(), workspaceId, parsed.data.documentId);
  const context = requireWorkspacePermission(actorId, workspaceId, "create_project");
  const now = new Date().toISOString();
  if (action === "document.delete") {
    if (current.creator_id !== actorId && context.role !== "admin") {
      throw new DomainValidationError("Only the document creator or an admin can delete it.");
    }
    const data = transaction((database) => { database.prepare("DELETE FROM documents WHERE id = ?").run(current.id); finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "document", entityId: current.id, eventType: "document.deleted", action: "document.deleted", createdAt: now }); return true; });
    return { data, eventType: "document.deleted", resourceId: current.id };
  }
  const changes = parsed.data.changes ?? {};
  const data = transaction((database) => {
    ensureProjectForDocument(database, workspaceId, changes.projectId);
    applyScalarChanges(database, "documents", current.id, changes, { title: "title", content: "content", projectId: "project_id" }, now);
    finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "document", entityId: current.id, eventType: "document.updated", action: "document.updated", metadata: { fields: Object.keys(changes) }, createdAt: now });
    return toDocument(getDocument(database, workspaceId, current.id));
  });
  return { data, eventType: "document.updated", resourceId: current.id };
}

function validateTemplateDefaults(database: Database, workspaceId: string, teamId: string | null, defaults: z.infer<typeof templateDefaultsSchema> | undefined): void {
  if (!defaults) return;
  if (defaults.statusId && (!teamId || !database.prepare("SELECT 1 FROM workflow_states WHERE id = ? AND team_id = ?").get(defaults.statusId, teamId))) throw new DomainValidationError("Template status must belong to its team.");
  if (defaults.assigneeId) ensureWorkspaceMember(database, workspaceId, defaults.assigneeId);
  if (defaults.projectId && !database.prepare("SELECT 1 FROM projects WHERE id = ? AND workspace_id = ?").get(defaults.projectId, workspaceId)) throw new DomainValidationError("Template project is unavailable.");
  if (defaults.cycleId && (!teamId || !database.prepare("SELECT 1 FROM cycles WHERE id = ? AND team_id = ?").get(defaults.cycleId, teamId))) throw new DomainValidationError("Template cycle must belong to its team.");
  for (const labelId of defaults.labelIds ?? []) if (!database.prepare(`SELECT 1 FROM labels WHERE id = ? AND workspace_id = ? AND (team_id IS NULL OR team_id = ?)` ).get(labelId, workspaceId, teamId)) throw new DomainValidationError("Template label is unavailable.");
}

function executeTemplateAction(action: string, workspaceId: string, actorId: string, payload: unknown): MutationResult<IssueTemplate | boolean> {
  if (action === "template.create") {
    const parsed = templateChangesSchema.extend({ name: z.string().trim().min(1).max(120), teamId: nullableIdSchema.optional() }).safeParse(payload);
    if (!parsed.success) invalid(parsed);
    ensureTeamScope(workspaceId, actorId, parsed.data.teamId ?? null);
    const id = createId("template"); const now = new Date().toISOString();
    const data = transaction((database) => {
      validateTemplateDefaults(database, workspaceId, parsed.data.teamId ?? null, parsed.data.defaults);
      database.prepare(`INSERT INTO issue_templates(id, workspace_id, team_id, name, title_template, description_template, defaults_json, sub_issues_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, workspaceId, parsed.data.teamId ?? null, parsed.data.name, parsed.data.titleTemplate ?? "", parsed.data.descriptionTemplate ?? "", JSON.stringify(parsed.data.defaults ?? {}), JSON.stringify(parsed.data.subIssues ?? []), now, now);
      finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "template", entityId: id, eventType: "template.created", action: "template.created", metadata: { teamId: parsed.data.teamId ?? null, name: parsed.data.name }, createdAt: now });
      return toTemplate(getTemplate(database, workspaceId, id));
    });
    return { data, eventType: "template.created", resourceId: id };
  }
  const parsed = z.object({ templateId: idSchema, changes: templateChangesSchema.optional() }).strict().safeParse(payload);
  if (!parsed.success) invalid(parsed);
  const current = getTemplate(getDatabase(), workspaceId, parsed.data.templateId); ensureTeamScope(workspaceId, actorId, current.team_id);
  if (parsed.data.changes?.teamId !== undefined) {
    ensureTeamScope(workspaceId, actorId, parsed.data.changes.teamId);
  }
  const now = new Date().toISOString();
  if (action === "template.delete") {
    const data = transaction((database) => { database.prepare("DELETE FROM issue_templates WHERE id = ?").run(current.id); finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "template", entityId: current.id, eventType: "template.deleted", action: "template.deleted", createdAt: now }); return true; });
    return { data, eventType: "template.deleted", resourceId: current.id };
  }
  const changes = parsed.data.changes ?? {};
  const data = transaction((database) => {
    const effectiveTeamId = changes.teamId === undefined ? current.team_id : changes.teamId;
    const effectiveDefaults = changes.defaults ?? parseJson<z.infer<typeof templateDefaultsSchema>>(current.defaults_json, {});
    validateTemplateDefaults(database, workspaceId, effectiveTeamId, effectiveDefaults);
    applyScalarChanges(database, "issue_templates", current.id, changes, { teamId: "team_id", name: "name", titleTemplate: "title_template", descriptionTemplate: "description_template" }, now);
    if (changes.defaults !== undefined) database.prepare("UPDATE issue_templates SET defaults_json = ? WHERE id = ?").run(JSON.stringify(changes.defaults), current.id);
    if (changes.subIssues !== undefined) database.prepare("UPDATE issue_templates SET sub_issues_json = ? WHERE id = ?").run(JSON.stringify(changes.subIssues), current.id);
    finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "template", entityId: current.id, eventType: "template.updated", action: "template.updated", metadata: { fields: Object.keys(changes) }, createdAt: now });
    return toTemplate(getTemplate(database, workspaceId, current.id));
  });
  return { data, eventType: "template.updated", resourceId: current.id };
}

function validateRecurringTemplate(database: Database, workspaceId: string, teamId: string, templateId: string): void {
  const template = database.prepare("SELECT team_id FROM issue_templates WHERE id = ? AND workspace_id = ?").get(templateId, workspaceId) as { team_id: string | null } | undefined;
  if (!template || (template.team_id !== null && template.team_id !== teamId)) throw new DomainValidationError("Recurring issue template is unavailable to this team.");
}

function executeRecurringAction(action: string, workspaceId: string, actorId: string, payload: unknown): MutationResult<RecurringIssue | boolean> {
  if (action === "recurringIssue.create") {
    const parsed = recurringChangesSchema.extend({ teamId: idSchema, templateId: idSchema, cadence: z.enum(["daily", "weekly", "monthly"]), nextRunAt: dateTimeSchema }).safeParse(payload);
    if (!parsed.success) invalid(parsed);
    const access = requireTeamPermission(actorId, parsed.data.teamId, "manage"); if (access.workspaceId !== workspaceId) throw new ResourceNotFoundError();
    const id = createId("recurring"); const now = new Date().toISOString();
    const data = transaction((database) => {
      validateRecurringTemplate(database, workspaceId, parsed.data.teamId, parsed.data.templateId);
      const timezone = parsed.data.timezone ?? getWorkspace(database, workspaceId).timezone;
      database.prepare(`INSERT INTO recurring_issues(id, workspace_id, team_id, template_id, cadence, interval, next_run_at, timezone, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, workspaceId, parsed.data.teamId, parsed.data.templateId, parsed.data.cadence, parsed.data.interval ?? 1, parsed.data.nextRunAt, timezone, parsed.data.isActive === false ? 0 : 1, now, now);
      finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "template", entityId: id, eventType: "recurringIssue.created", action: "recurringIssue.created", metadata: { teamId: parsed.data.teamId, templateId: parsed.data.templateId }, createdAt: now });
      return toRecurring(getRecurring(database, workspaceId, id));
    });
    return { data, eventType: "recurringIssue.created", resourceId: id };
  }
  const parsed = z.object({ recurringIssueId: idSchema.optional(), recurringId: idSchema.optional(), changes: recurringChangesSchema.optional() }).strict().refine((value) => Boolean(value.recurringIssueId || value.recurringId), "Recurring issue id is required.").safeParse(payload);
  if (!parsed.success) invalid(parsed);
  const current = getRecurring(getDatabase(), workspaceId, parsed.data.recurringIssueId ?? parsed.data.recurringId!);
  const access = requireTeamPermission(actorId, current.team_id, "manage"); if (access.workspaceId !== workspaceId) throw new ResourceNotFoundError();
  const now = new Date().toISOString();
  if (action === "recurringIssue.delete") {
    const data = transaction((database) => { database.prepare("DELETE FROM recurring_issues WHERE id = ?").run(current.id); finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "template", entityId: current.id, eventType: "recurringIssue.deleted", action: "recurringIssue.deleted", createdAt: now }); return true; });
    return { data, eventType: "recurringIssue.deleted", resourceId: current.id };
  }
  const changes = parsed.data.changes ?? {};
  const data = transaction((database) => {
    if (changes.templateId) validateRecurringTemplate(database, workspaceId, current.team_id, changes.templateId);
    applyScalarChanges(database, "recurring_issues", current.id, changes, { templateId: "template_id", cadence: "cadence", interval: "interval", nextRunAt: "next_run_at", timezone: "timezone", isActive: "is_active" }, now);
    finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "template", entityId: current.id, eventType: "recurringIssue.updated", action: "recurringIssue.updated", metadata: { fields: Object.keys(changes) }, createdAt: now });
    return toRecurring(getRecurring(database, workspaceId, current.id));
  });
  return { data, eventType: "recurringIssue.updated", resourceId: current.id };
}

function updateNotificationPreferences(workspaceId: string, actorId: string, payload: unknown): MutationResult<Array<{ channel: string; eventType: string; enabled: boolean }>> {
  const context = requireWorkspacePermission(actorId, workspaceId, "read");
  const item = z.object({ channel: z.enum(["inbox", "email", "browser"]), eventType: z.string().trim().min(1).max(100), enabled: z.boolean() }).strict();
  const settingsDraft = z.object({
    assigned: z.boolean(), mentioned: z.boolean(), subscribed: z.boolean(),
    projectUpdates: z.boolean(),
  }).strict();
  const parsed = z.union([
    item,
    z.object({ preferences: z.array(item).min(1).max(100) }).strict(),
    z.object({ preferences: settingsDraft }).strict(),
  ]).safeParse(payload);
  if (!parsed.success) invalid(parsed);
  const preferences = !("preferences" in parsed.data)
    ? [parsed.data]
    : Array.isArray(parsed.data.preferences)
      ? parsed.data.preferences
      : [
          { channel: "inbox" as const, eventType: "assigned", enabled: parsed.data.preferences.assigned },
          { channel: "inbox" as const, eventType: "mentioned", enabled: parsed.data.preferences.mentioned },
          { channel: "inbox" as const, eventType: "subscribed", enabled: parsed.data.preferences.subscribed },
          { channel: "inbox" as const, eventType: "projectUpdates", enabled: parsed.data.preferences.projectUpdates },
        ];
  const now = new Date().toISOString();
  const data = transaction((database) => {
    const upsert = database.prepare(`INSERT INTO notification_preferences(user_id, workspace_id, channel, event_type, enabled) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, workspace_id, channel, event_type) DO UPDATE SET enabled = excluded.enabled`);
    for (const preference of preferences) upsert.run(actorId, workspaceId, preference.channel, preference.eventType, preference.enabled ? 1 : 0);
    finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "member", entityId: context.membershipId, eventType: "notificationPreferences.updated", action: "notificationPreferences.updated", metadata: { count: preferences.length }, createdAt: now });
    return preferences;
  });
  return { data, eventType: "notificationPreferences.updated", resourceId: actorId };
}

function executeApiKeyAction(action: string, workspaceId: string, actorId: string, payload: unknown): MutationResult<ApiKeySecretResult | boolean> {
  const context = requireWorkspacePermission(actorId, workspaceId, "read");
  if (context.role === "guest") throw new DomainValidationError("Guests cannot manage API keys.");
  if (action === "apiKey.create") {
    const parsed = z.object({ name: z.string().trim().min(1).max(120), scopes: z.array(apiScopeSchema).min(1).max(20).optional(), expiresAt: dateTimeSchema.nullable().optional() }).strict().safeParse(payload);
    if (!parsed.success) invalid(parsed);
    const id = createId("apikey"); const token = `orb_${generateOpaqueToken()}`; const prefix = token.slice(0, 12); const now = new Date().toISOString();
    const data = transaction((database) => {
      database.prepare(`INSERT INTO api_keys(id, workspace_id, user_id, name, prefix, token_hash, scopes_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, workspaceId, actorId, parsed.data.name, prefix, hashOpaqueToken(token), JSON.stringify(parsed.data.scopes ?? ["workspace:read", "issues:read", "issues:write", "projects:read"]), parsed.data.expiresAt ?? null, now);
      finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "apiKey", entityId: id, eventType: "apiKey.created", action: "apiKey.created", metadata: { name: parsed.data.name }, createdAt: now });
      return { apiKey: toApiKey(database.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as unknown as ApiKeyRow), token };
    });
    return { data, eventType: "apiKey.created", resourceId: id };
  }
  const parsed = z.object({ apiKeyId: idSchema }).strict().safeParse(payload); if (!parsed.success) invalid(parsed);
  const row = getDatabase().prepare("SELECT * FROM api_keys WHERE id = ? AND workspace_id = ?").get(parsed.data.apiKeyId, workspaceId) as ApiKeyRow | undefined;
  if (!row) throw new ResourceNotFoundError("API key not found.");
  if (row.user_id !== actorId && context.role !== "admin") throw new ResourceNotFoundError("API key not found.");
  const now = new Date().toISOString();
  const data = transaction((database) => { database.prepare("DELETE FROM api_keys WHERE id = ?").run(row.id); finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "apiKey", entityId: row.id, eventType: "apiKey.revoked", action: "apiKey.revoked", createdAt: now }); return true; });
  return { data, eventType: "apiKey.revoked", resourceId: row.id };
}

function executeWebhookAction(action: string, workspaceId: string, actorId: string, payload: unknown): MutationResult<WebhookSecretResult | boolean> {
  requireWorkspacePermission(actorId, workspaceId, "manage_settings");
  if (action === "webhook.create") {
    const parsed = webhookChangesSchema.extend({
      name: z.string().trim().min(1).max(120),
      url: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Webhook URL must use HTTP or HTTPS."),
      events: z.array(webhookEventSchema).min(1).max(30),
    }).safeParse(payload); if (!parsed.success) invalid(parsed);
    const id = createId("webhook"); const secret = `whsec_${generateOpaqueToken()}`; const now = new Date().toISOString();
    const data = transaction((database) => {
      database.prepare(`INSERT INTO webhooks(id, workspace_id, name, url, secret_hash, signing_secret_encrypted, events_json, is_active, created_by_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, workspaceId, parsed.data.name, parsed.data.url, hashOpaqueToken(secret), sealWebhookSecret(secret), JSON.stringify([...new Set(parsed.data.events)]), parsed.data.isActive === false ? 0 : 1, actorId, now, now);
      finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "webhook", entityId: id, eventType: "webhook.created", action: "webhook.created", metadata: { name: parsed.data.name }, createdAt: now });
      return { webhook: toWebhook(getWebhook(database, workspaceId, id)), secret };
    });
    return { data, eventType: "webhook.created", resourceId: id };
  }
  const parsed = z.object({ webhookId: idSchema, changes: webhookChangesSchema.optional() }).strict().safeParse(payload); if (!parsed.success) invalid(parsed);
  const current = getWebhook(getDatabase(), workspaceId, parsed.data.webhookId); const now = new Date().toISOString();
  if (action === "webhook.delete") {
    const data = transaction((database) => { database.prepare("DELETE FROM webhooks WHERE id = ?").run(current.id); finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "webhook", entityId: current.id, eventType: "webhook.deleted", action: "webhook.deleted", createdAt: now }); return true; });
    return { data, eventType: "webhook.deleted", resourceId: current.id };
  }
  const changes = parsed.data.changes ?? {}; const secret = changes.rotateSecret ? `whsec_${generateOpaqueToken()}` : undefined;
  const data = transaction((database) => {
    applyScalarChanges(database, "webhooks", current.id, changes, { name: "name", url: "url", isActive: "is_active" }, now);
    if (changes.events) database.prepare("UPDATE webhooks SET events_json = ? WHERE id = ?").run(JSON.stringify([...new Set(changes.events)]), current.id);
    if (secret) database.prepare("UPDATE webhooks SET secret_hash = ?, signing_secret_encrypted = ? WHERE id = ?").run(hashOpaqueToken(secret), sealWebhookSecret(secret), current.id);
    finishAdministrativeMutation(database, { workspaceId, actorId, entityType: "webhook", entityId: current.id, eventType: "webhook.updated", action: "webhook.updated", metadata: { fields: Object.keys(changes) }, createdAt: now });
    return { webhook: toWebhook(getWebhook(database, workspaceId, current.id)), ...(secret ? { secret } : {}) };
  });
  return { data, eventType: "webhook.updated", resourceId: current.id };
}

const aliases: Record<string, string> = {
  "state.create": "workflowState.create", "state.update": "workflowState.update", "state.delete": "workflowState.delete",
  "recurring.create": "recurringIssue.create", "recurring.update": "recurringIssue.update", "recurring.delete": "recurringIssue.delete",
  "apiKey.delete": "apiKey.revoke",
};

export function executeWorkspaceAction(action: string, workspaceId: string, actorId: string, payload: unknown): MutationResult | null {
  const normalized = aliases[action] ?? action;
  if (normalized === "account.update") return updateAccount(workspaceId, actorId, payload);
  if (normalized === "workspace.update") return updateWorkspace(workspaceId, actorId, payload);
  if (normalized === "member.invite") return inviteMember(workspaceId, actorId, payload);
  if (normalized === "member.update" || normalized === "member.suspend") return updateMember(normalized, workspaceId, actorId, payload);
  if (normalized === "team.create") return createTeam(workspaceId, actorId, payload);
  if (normalized === "team.update") return updateTeam(workspaceId, actorId, payload);
  if (["workflowState.create", "workflowState.update", "workflowState.delete"].includes(normalized)) return executeStateAction(normalized, workspaceId, actorId, payload);
  if (["label.create", "label.update", "label.delete"].includes(normalized)) return executeLabelAction(normalized, workspaceId, actorId, payload);
  if (["document.create", "document.update", "document.delete"].includes(normalized)) return executeDocumentAction(normalized, workspaceId, actorId, payload);
  if (["template.create", "template.update", "template.delete"].includes(normalized)) return executeTemplateAction(normalized, workspaceId, actorId, payload);
  if (["recurringIssue.create", "recurringIssue.update", "recurringIssue.delete"].includes(normalized)) return executeRecurringAction(normalized, workspaceId, actorId, payload);
  if (normalized === "notificationPreferences.update") return updateNotificationPreferences(workspaceId, actorId, payload);
  if (normalized === "apiKey.create" || normalized === "apiKey.revoke") return executeApiKeyAction(normalized, workspaceId, actorId, payload);
  if (["webhook.create", "webhook.update", "webhook.delete"].includes(normalized)) return executeWebhookAction(normalized, workspaceId, actorId, payload);
  return null;
}
