import "server-only";

import { cookies } from "next/headers";

import type {
  MembershipStatus,
  SessionUser,
  Team,
  TeamMember,
  User,
  Workspace,
  WorkspaceRole,
} from "@/lib/domain";
import { getAll, getOne, nowIso, run, transaction } from "@/lib/db";
import {
  createId,
  generateOpaqueToken,
  hashNetworkAddress,
  hashOpaqueToken,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_SECONDS,
  slugify,
} from "@/lib/security";

interface UserRow {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  created_at: string;
}

interface CredentialRow extends UserRow {
  password_hash: string;
  disabled_at: string | null;
}

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  icon: string;
  timezone: string;
  created_at: string;
  role: WorkspaceRole;
}

interface SessionRow extends UserRow {
  session_id: string;
  user_id: string;
  expires_at: string;
  last_seen_at: string;
  disabled_at: string | null;
}

interface WorkspaceAccessRow {
  membership_id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  status: MembershipStatus;
}

interface TeamAccessRow extends WorkspaceAccessRow {
  team_id: string;
  is_private: number;
  team_role: TeamMember["role"] | null;
}

export interface SessionMetadata {
  readonly userAgent?: string | null;
  readonly ipAddress?: string | null;
}

export interface AuthSession {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: string;
  readonly user: SessionUser;
}

export interface CreatedSession extends AuthSession {
  readonly token: string;
}

export interface SignupAccountInput {
  readonly name: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly workspaceName?: string;
  readonly workspaceSlug?: string;
}

/**
 * A fresh installation may create its first workspace administrator. After
 * that, accounts should enter through invitation acceptance unless an operator
 * explicitly opts into multi-workspace public signup.
 */
export function isWorkspaceSignupAllowed(): boolean {
  if (process.env.ORBIT_ALLOW_PUBLIC_SIGNUP === "1") return true;
  const users = getOne<{ count: number }>("SELECT COUNT(*) AS count FROM users");
  return Number(users?.count ?? 0) === 0;
}

export type WorkspacePermission =
  | "read"
  | "create_issue"
  | "create_project"
  | "create_team"
  | "create_view"
  | "manage_members"
  | "manage_settings";

export type TeamPermission = "read" | "create_issue" | "edit_issue" | "manage";

export interface WorkspacePermissionContext {
  readonly membershipId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: WorkspaceRole;
  readonly status: MembershipStatus;
}

export interface TeamPermissionContext extends WorkspacePermissionContext {
  readonly teamId: string;
  readonly isPrivate: boolean;
  readonly teamRole: TeamMember["role"] | null;
}

export class AuthenticationError extends Error {
  readonly status = 401;

  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class PermissionError extends Error {
  readonly status = 403;

  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "PermissionError";
  }
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
  };
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

export function getCredentialByEmail(email: string): CredentialRow | undefined {
  return getOne<CredentialRow>(
    `SELECT u.id, u.name, u.email, u.avatar_url, u.created_at, u.disabled_at,
            pc.password_hash
       FROM users u
       JOIN password_credentials pc ON pc.user_id = u.id
      WHERE u.email = ? COLLATE NOCASE`,
    email,
  );
}

export function getSessionUser(userId: string): SessionUser | null {
  const user = getOne<UserRow>(
    `SELECT id, name, email, avatar_url, created_at
       FROM users
      WHERE id = ? AND disabled_at IS NULL`,
    userId,
  );
  if (!user) return null;

  const workspaces = getAll<WorkspaceRow>(
    `SELECT w.id, w.name, w.slug, w.icon, w.timezone, w.created_at, wm.role
       FROM workspace_members wm
       JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = ? AND wm.status = 'active'
      ORDER BY w.name COLLATE NOCASE`,
    userId,
  );

  return {
    ...toUser(user),
    workspaces: workspaces.map((workspace) => ({
      ...toWorkspace(workspace),
      role: workspace.role,
    })),
  };
}

export function createSession(userId: string, metadata: SessionMetadata = {}): CreatedSession {
  const token = generateOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_SECONDS * 1_000).toISOString();
  const id = createId("ses");

  transaction((database) => {
    database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(createdAt);
    database
      .prepare(
        `INSERT INTO sessions(
          id, user_id, token_hash, expires_at, last_seen_at, user_agent, ip_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        tokenHash,
        expiresAt,
        createdAt,
        metadata.userAgent?.slice(0, 512) || null,
        hashNetworkAddress(metadata.ipAddress ?? null),
        createdAt,
      );
  });

  const user = getSessionUser(userId);
  if (!user) {
    run("DELETE FROM sessions WHERE id = ?", id);
    throw new AuthenticationError("The account is not active.");
  }

  return { id, userId, expiresAt, user, token };
}

export function getSessionByToken(token: string | null | undefined): AuthSession | null {
  if (!token) return null;

  const tokenHash = hashOpaqueToken(token);
  const session = getOne<SessionRow>(
    `SELECT s.id AS session_id, s.user_id, s.expires_at, s.last_seen_at,
            u.id, u.name, u.email, u.avatar_url, u.created_at, u.disabled_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    tokenHash,
  );
  if (!session) return null;

  const currentTime = Date.now();
  if (session.disabled_at || Date.parse(session.expires_at) <= currentTime) {
    run("DELETE FROM sessions WHERE id = ?", session.session_id);
    return null;
  }

  const user = getSessionUser(session.user_id);
  if (!user) {
    run("DELETE FROM sessions WHERE id = ?", session.session_id);
    return null;
  }

  if (currentTime - Date.parse(session.last_seen_at) > 5 * 60 * 1_000) {
    run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", nowIso(), session.session_id);
  }

  return {
    id: session.session_id,
    userId: session.user_id,
    expiresAt: session.expires_at,
    user,
  };
}

export async function getCurrentSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  return getSessionByToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}

export async function requireCurrentSession(): Promise<AuthSession> {
  const session = await getCurrentSession();
  if (!session) throw new AuthenticationError();
  return session;
}

export function deleteSessionByToken(token: string | null | undefined): void {
  if (!token) return;
  run("DELETE FROM sessions WHERE token_hash = ?", hashOpaqueToken(token));
}

export function deleteAllUserSessions(userId: string): void {
  run("DELETE FROM sessions WHERE user_id = ?", userId);
}

export function isLoginRateLimited(identity: string): boolean {
  const since = new Date(Date.now() - 15 * 60 * 1_000).toISOString();
  const result = getOne<{ failures: number }>(
    `SELECT COUNT(*) AS failures
       FROM auth_attempts
      WHERE identity = ? AND succeeded = 0 AND attempted_at >= ?`,
    identity,
    since,
  );
  return Number(result?.failures ?? 0) >= 8;
}

export function recordFailedLogin(identity: string): void {
  const timestamp = nowIso();
  transaction((database) => {
    database
      .prepare("DELETE FROM auth_attempts WHERE attempted_at < ?")
      .run(new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString());
    database
      .prepare(
        "INSERT INTO auth_attempts(identity, succeeded, attempted_at) VALUES (?, 0, ?)",
      )
      .run(identity, timestamp);
  });
}

export function clearLoginFailures(identity: string): void {
  run("DELETE FROM auth_attempts WHERE identity = ?", identity);
}

function nextAvailableWorkspaceSlug(requested: string): string {
  const base = slugify(requested);
  let candidate = base;
  let suffix = 2;
  while (getOne<{ found: number }>("SELECT 1 AS found FROM workspaces WHERE slug = ?", candidate)) {
    candidate = `${base.slice(0, 43)}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function createSignupAccount(input: SignupAccountInput): SessionUser {
  const now = nowIso();
  const userId = createId("usr");
  const workspaceId = createId("ws");
  const membershipId = createId("wmem");
  const teamId = createId("team");
  const workspaceName = input.workspaceName?.trim() || `${input.name}'s workspace`;
  const workspaceSlug = nextAvailableWorkspaceSlug(input.workspaceSlug || workspaceName);
  const icon = workspaceName.trim().charAt(0).toUpperCase() || "O";

  transaction((database) => {
    database
      .prepare(
        `INSERT INTO users(id, name, email, avatar_url, timezone, locale, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'UTC', 'en', ?, ?)`,
      )
      .run(userId, input.name, input.email, now, now);
    database
      .prepare(
        `INSERT INTO password_credentials(user_id, password_hash, password_changed_at)
         VALUES (?, ?, ?)`,
      )
      .run(userId, input.passwordHash, now);
    database
      .prepare(
        `INSERT INTO workspaces(id, name, slug, icon, timezone, settings_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'UTC', '{}', ?, ?)`,
      )
      .run(workspaceId, workspaceName, workspaceSlug, icon, now, now);
    database
      .prepare(
        `INSERT INTO workspace_members(id, workspace_id, user_id, role, status, joined_at)
         VALUES (?, ?, ?, 'admin', 'active', ?)`,
      )
      .run(membershipId, workspaceId, userId, now);
    database
      .prepare(
        `INSERT INTO teams(
          id, workspace_id, name, key, description, color, icon, is_private,
          triage_enabled, next_issue_number, created_at, updated_at
        ) VALUES (?, ?, 'General', 'GEN', 'General product work', '#5E6AD2', 'G', 0, 0, 1, ?, ?)`,
      )
      .run(teamId, workspaceId, now, now);
    database
      .prepare(
        `INSERT INTO team_members(team_id, user_id, role, joined_at)
         VALUES (?, ?, 'lead', ?)`,
      )
      .run(teamId, userId, now);

    const workflowStates = [
      [createId("state"), "Backlog", "backlog", "#6B7280", 100, 1],
      [createId("state"), "Todo", "unstarted", "#E2B340", 200, 0],
      [createId("state"), "In Progress", "started", "#5E6AD2", 300, 0],
      [createId("state"), "Done", "completed", "#5EBD8C", 400, 0],
      [createId("state"), "Canceled", "canceled", "#9CA3AF", 500, 0],
    ] as const;
    const insertState = database.prepare(
      `INSERT INTO workflow_states(
        id, team_id, name, type, color, position, is_default, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [id, name, type, color, position, isDefault] of workflowStates) {
      insertState.run(id, teamId, name, type, color, position, isDefault, now);
    }
  });

  const user = getSessionUser(userId);
  if (!user) throw new Error("Failed to create the account.");
  return user;
}

export function getWorkspacePermissionContext(
  userId: string,
  workspaceId: string,
): WorkspacePermissionContext | null {
  const row = getOne<WorkspaceAccessRow>(
    `SELECT id AS membership_id, workspace_id, user_id, role, status
       FROM workspace_members
      WHERE user_id = ? AND workspace_id = ?`,
    userId,
    workspaceId,
  );
  if (!row) return null;
  return {
    membershipId: row.membership_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
  };
}

export function hasWorkspacePermission(
  context: WorkspacePermissionContext | null,
  permission: WorkspacePermission,
): boolean {
  if (!context || context.status !== "active") return false;
  if (context.role === "admin") return true;

  if (context.role === "member") {
    return ["read", "create_issue", "create_project", "create_team", "create_view"].includes(
      permission,
    );
  }
  return permission === "read" || permission === "create_view";
}

export function requireWorkspacePermission(
  userId: string,
  workspaceId: string,
  permission: WorkspacePermission,
): WorkspacePermissionContext {
  const context = getWorkspacePermissionContext(userId, workspaceId);
  if (!context || !hasWorkspacePermission(context, permission)) throw new PermissionError();
  return context;
}

export function getTeamPermissionContext(
  userId: string,
  teamId: string,
): TeamPermissionContext | null {
  const row = getOne<TeamAccessRow>(
    `SELECT wm.id AS membership_id, wm.workspace_id, wm.user_id, wm.role, wm.status,
            t.id AS team_id, t.is_private, tm.role AS team_role
       FROM teams t
       JOIN workspace_members wm
         ON wm.workspace_id = t.workspace_id AND wm.user_id = ?
       LEFT JOIN team_members tm
         ON tm.team_id = t.id AND tm.user_id = wm.user_id
      WHERE t.id = ?`,
    userId,
    teamId,
  );
  if (!row) return null;
  return {
    membershipId: row.membership_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    teamId: row.team_id,
    isPrivate: Boolean(row.is_private),
    teamRole: row.team_role,
  };
}

export function hasTeamPermission(
  context: TeamPermissionContext | null,
  permission: TeamPermission,
): boolean {
  if (!context || context.status !== "active") return false;
  const isExplicitMember = context.teamRole !== null;
  if (context.isPrivate && !isExplicitMember) return false;
  if (context.role === "admin") return true;

  const canRead = !context.isPrivate && context.role === "member" ? true : isExplicitMember;
  if (!canRead) return false;
  if (permission === "read") return true;
  if (permission === "manage") return context.teamRole === "lead";
  return context.role === "member" || isExplicitMember;
}

export function requireTeamPermission(
  userId: string,
  teamId: string,
  permission: TeamPermission,
): TeamPermissionContext {
  const context = getTeamPermissionContext(userId, teamId);
  if (!context || !hasTeamPermission(context, permission)) throw new PermissionError();
  return context;
}

export function getAccessibleTeams(userId: string, workspaceId: string): Team[] {
  const workspaceContext = getWorkspacePermissionContext(userId, workspaceId);
  if (!workspaceContext || workspaceContext.status !== "active") return [];

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

  const rows = getAll<TeamRow>(
    `SELECT DISTINCT t.id, t.workspace_id, t.name, t.key, t.description, t.color,
            t.icon, t.is_private, t.triage_enabled, t.created_at
       FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = ?
      WHERE t.workspace_id = ?
        AND (
          (t.is_private = 0 AND ? IN ('admin', 'member')) OR
          tm.user_id IS NOT NULL
        )
      ORDER BY t.name COLLATE NOCASE`,
    userId,
    workspaceId,
    workspaceContext.role,
  );

  return rows.map((row) => ({
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
  }));
}
