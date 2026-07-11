import "server-only";

import type { Database } from "@/lib/db";
import { getDatabase, transaction } from "@/lib/db";
import type { WorkspaceRole } from "@/lib/domain";
import { createId, hashOpaqueToken } from "@/lib/security";
import {
  ConflictError,
  finishMutation,
  recordAudit,
  ResourceNotFoundError,
} from "@/modules/shared/mutation";

interface InvitationRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  workspace_icon: string;
  workspace_timezone: string;
  email: string;
  role: WorkspaceRole;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_id: string | null;
  existing_user_id: string | null;
}

export interface InvitationSummary {
  id: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: string;
  acceptedAt: string | null;
  existingUser: boolean;
  expired: boolean;
  workspace: {
    id: string;
    name: string;
    slug: string;
    icon: string;
  };
}

export interface AcceptedInvitation {
  userId: string;
  workspaceId: string;
  workspaceSlug: string;
}

export class InvitationExpiredError extends Error {
  readonly status = 410;

  constructor() {
    super("This invitation has expired. Ask a workspace admin for a new link.");
    this.name = "InvitationExpiredError";
  }
}

function invitationRow(database: Database, token: string): InvitationRow {
  const row = database
    .prepare(
      `SELECT i.id, i.workspace_id, i.email, i.role, i.expires_at,
              i.accepted_at, i.accepted_by_id,
              w.name AS workspace_name, w.slug AS workspace_slug,
              w.icon AS workspace_icon, w.timezone AS workspace_timezone,
              u.id AS existing_user_id
         FROM invitations i
         JOIN workspaces w ON w.id = i.workspace_id
         LEFT JOIN users u ON u.email = i.email COLLATE NOCASE
        WHERE i.token_hash = ?`,
    )
    .get(hashOpaqueToken(token)) as InvitationRow | undefined;
  if (!row) throw new ResourceNotFoundError("Invitation not found.");
  return row;
}

function assertInvitationUsable(row: InvitationRow): void {
  if (row.accepted_at) {
    throw new ConflictError("This invitation has already been accepted.");
  }
  if (Date.parse(row.expires_at) <= Date.now()) throw new InvitationExpiredError();
}

function completeInvitation(
  database: Database,
  invitation: InvitationRow,
  userId: string,
  now: string,
): AcceptedInvitation {
  const existingMembership = database
    .prepare("SELECT id, status FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
    .get(invitation.workspace_id, userId) as { id: string; status: "active" | "suspended" } | undefined;
  if (existingMembership?.status === "suspended") {
    throw new ConflictError("This workspace membership is suspended.");
  }
  const membershipId = existingMembership?.id ?? createId("wmem");
  if (!existingMembership) {
    const membershipCount = database
      .prepare("SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ?")
      .get(invitation.workspace_id) as { count: number };
    if (Number(membershipCount.count) >= 100) {
      throw new ConflictError("This workspace has reached its 100-member limit.");
    }
    database
      .prepare(
        `INSERT INTO workspace_members(id, workspace_id, user_id, role, status, joined_at)
         VALUES (?, ?, ?, ?, 'active', ?)`,
      )
      .run(membershipId, invitation.workspace_id, userId, invitation.role, now);
  }
  database
    .prepare(
      `UPDATE invitations
          SET accepted_by_id = ?, accepted_at = ?
        WHERE id = ? AND accepted_at IS NULL`,
    )
    .run(userId, now, invitation.id);
  finishMutation(database, {
    workspaceId: invitation.workspace_id,
    actorId: userId,
    entityType: "member",
    entityId: membershipId,
    eventType: "member.joined",
    action: "invitation.accepted",
    createdAt: now,
  });
  recordAudit(database, {
    workspaceId: invitation.workspace_id,
    actorId: userId,
    action: "invitation.accepted",
    entityType: "member",
    entityId: membershipId,
    metadata: { invitationId: invitation.id, role: invitation.role },
    createdAt: now,
  });
  return {
    userId,
    workspaceId: invitation.workspace_id,
    workspaceSlug: invitation.workspace_slug,
  };
}

export function getInvitationSummary(token: string): InvitationSummary | null {
  try {
    const row = invitationRow(getDatabase(), token);
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at,
      existingUser: Boolean(row.existing_user_id),
      expired: Date.parse(row.expires_at) <= Date.now(),
      workspace: {
        id: row.workspace_id,
        name: row.workspace_name,
        slug: row.workspace_slug,
        icon: row.workspace_icon,
      },
    };
  } catch (error) {
    if (error instanceof ResourceNotFoundError) return null;
    throw error;
  }
}

export function acceptInvitationForUser(token: string, userId: string): AcceptedInvitation {
  return transaction((database) => {
    const invitation = invitationRow(database, token);
    if (invitation.accepted_at && invitation.accepted_by_id === userId) {
      return {
        userId,
        workspaceId: invitation.workspace_id,
        workspaceSlug: invitation.workspace_slug,
      };
    }
    assertInvitationUsable(invitation);
    const user = database
      .prepare("SELECT email, disabled_at FROM users WHERE id = ?")
      .get(userId) as { email: string; disabled_at: string | null } | undefined;
    if (!user || user.disabled_at) throw new ResourceNotFoundError("Account not found.");
    if (user.email.toLocaleLowerCase() !== invitation.email.toLocaleLowerCase()) {
      throw new ConflictError("Sign in with the email address that received this invitation.");
    }
    return completeInvitation(database, invitation, userId, new Date().toISOString());
  });
}

export function createAccountFromInvitation(
  token: string,
  input: { name: string; passwordHash: string },
): AcceptedInvitation {
  return transaction((database) => {
    const invitation = invitationRow(database, token);
    assertInvitationUsable(invitation);
    if (invitation.existing_user_id) {
      throw new ConflictError("An account already exists for this email. Sign in before accepting the invitation.");
    }
    const now = new Date().toISOString();
    const userId = createId("usr");
    database
      .prepare(
        `INSERT INTO users(id, name, email, timezone, locale, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'en', ?, ?)`,
      )
      .run(userId, input.name, invitation.email, invitation.workspace_timezone, now, now);
    database
      .prepare(
        `INSERT INTO password_credentials(user_id, password_hash, password_changed_at)
         VALUES (?, ?, ?)`,
      )
      .run(userId, input.passwordHash, now);
    return completeInvitation(database, invitation, userId, now);
  });
}
