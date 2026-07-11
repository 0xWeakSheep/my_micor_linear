import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionByToken } from "@/lib/auth";
import { getDatabase, transaction } from "@/lib/db";
import type { ActionResult } from "@/lib/domain";
import {
  hashPassword,
  readSessionCookie,
  validatePassword,
  verifyPassword,
} from "@/lib/security";
import { recordAudit } from "@/modules/shared/mutation";

import { errorResponse, rejectUntrustedRequest } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(1).max(128),
  })
  .strict();

export async function POST(request: NextRequest) {
  const rejected = rejectUntrustedRequest(request);
  if (rejected) return rejected;

  const session = getSessionByToken(readSessionCookie(request.cookies));
  if (!session) return errorResponse("Authentication required.", 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }
  const parsed = passwordSchema.safeParse(payload);
  if (!parsed.success) return errorResponse("Check the password fields and try again.", 400);
  const passwordError = validatePassword(parsed.data.newPassword);
  if (passwordError) return errorResponse(passwordError, 400);
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return errorResponse("Choose a different new password.", 400);
  }

  const credential = getDatabase()
    .prepare("SELECT password_hash AS passwordHash FROM password_credentials WHERE user_id = ?")
    .get(session.userId) as { passwordHash: string } | undefined;
  if (!credential || !(await verifyPassword(parsed.data.currentPassword, credential.passwordHash))) {
    return errorResponse("Current password is incorrect.", 400);
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  const now = new Date().toISOString();
  const revokedSessions = transaction((database) => {
    database
      .prepare("UPDATE password_credentials SET password_hash = ?, password_changed_at = ? WHERE user_id = ?")
      .run(passwordHash, now, session.userId);
    const revoked = database
      .prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?")
      .run(session.userId, session.id);
    const workspaces = database
      .prepare(
        "SELECT workspace_id AS workspaceId FROM workspace_members WHERE user_id = ? AND status = 'active'",
      )
      .all(session.userId) as Array<{ workspaceId: string }>;
    for (const workspace of workspaces) {
      recordAudit(database, {
        workspaceId: workspace.workspaceId,
        actorId: session.userId,
        action: "account.password-changed",
        entityType: "member",
        entityId: session.userId,
        metadata: { revokedSessions: Number(revoked.changes) },
        createdAt: now,
      });
    }
    return Number(revoked.changes);
  });

  return NextResponse.json<ActionResult<{ revokedSessions: number }>>(
    { ok: true, data: { revokedSessions } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
