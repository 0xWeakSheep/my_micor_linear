import { NextResponse, type NextRequest } from "next/server";

import {
  AuthenticationError,
  getSessionByToken,
  PermissionError,
  requireTeamPermission,
  requireWorkspacePermission,
} from "@/lib/auth";
import { getOne, transaction } from "@/lib/db";
import type { ActionResult } from "@/lib/domain";
import { publishWorkspaceEvent } from "@/lib/events";
import { readAttachment, removeAttachment } from "@/lib/file-storage";
import { isTrustedRequest, SESSION_COOKIE_NAME } from "@/lib/security";
import { recordAudit, ResourceNotFoundError } from "@/modules/shared/mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ fileId: string }>;
}

interface FileRow {
  id: string;
  workspace_id: string;
  uploader_id: string;
  storage_key: string;
  name: string;
  size: number;
  mime: string;
  issue_id: string;
  team_id: string;
}

function getFile(fileId: string): FileRow {
  const row = getOne<FileRow>(
    `SELECT f.id, f.workspace_id, f.uploader_id, f.storage_key, f.name, f.size, f.mime,
            i.id AS issue_id, i.team_id
       FROM files f
       LEFT JOIN issue_attachments ia ON ia.file_id = f.id
       LEFT JOIN comment_attachments ca ON ca.file_id = f.id
       LEFT JOIN comments c ON c.id = ca.comment_id
       JOIN issues i ON i.id = COALESCE(ia.issue_id, c.issue_id)
      WHERE f.id = ? AND i.trashed_at IS NULL`,
    fileId,
  );
  if (!row) throw new ResourceNotFoundError("Attachment not found.");
  return row;
}

function dispositionFilename(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback || "attachment"}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function errorResponse(error: unknown) {
  const status = error instanceof AuthenticationError ? 401
    : error instanceof PermissionError ? 403
      : error instanceof ResourceNotFoundError ? 404 : 500;
  if (status === 500) console.error("Attachment request failed", error);
  return NextResponse.json<ActionResult>(
    { ok: false, error: error instanceof Error ? error.message : "Attachment request failed." },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionByToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
    if (!session) throw new AuthenticationError();
    const { fileId } = await context.params;
    const file = getFile(fileId);
    requireTeamPermission(session.userId, file.team_id, "read");
    const bytes = await readAttachment(file.storage_key);
    const body = new Blob([
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    ], { type: file.mime });
    return new NextResponse(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": dispositionFilename(file.name),
        "Content-Length": String(file.size),
        "Content-Type": file.mime,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isTrustedRequest(request)) {
    return NextResponse.json<ActionResult>({ ok: false, error: "Cross-site request rejected." }, { status: 403 });
  }
  try {
    const session = getSessionByToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
    if (!session) throw new AuthenticationError();
    const { fileId } = await context.params;
    const file = getFile(fileId);
    requireTeamPermission(session.userId, file.team_id, "edit_issue");
    const workspaceContext = requireWorkspacePermission(session.userId, file.workspace_id, "read");
    if (file.uploader_id !== session.userId && workspaceContext.role !== "admin") throw new PermissionError();

    const createdAt = new Date().toISOString();
    transaction((database) => {
      database.prepare("DELETE FROM files WHERE id = ?").run(file.id);
      recordAudit(database, {
        workspaceId: file.workspace_id,
        actorId: session.userId,
        action: "attachment.deleted",
        entityType: "file",
        entityId: file.id,
        metadata: { issueId: file.issue_id, name: file.name },
        createdAt,
      });
    });
    await removeAttachment(file.storage_key);
    publishWorkspaceEvent({
      workspaceId: file.workspace_id,
      type: "attachment.deleted",
      resourceId: file.issue_id,
      actorId: session.userId,
    });
    return NextResponse.json<ActionResult<boolean>>(
      { ok: true, data: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
