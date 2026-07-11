import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  AuthenticationError,
  getSessionByToken,
  PermissionError,
  requireTeamPermission,
} from "@/lib/auth";
import { getOne, transaction } from "@/lib/db";
import type { ActionResult, Attachment } from "@/lib/domain";
import { publishWorkspaceEvent } from "@/lib/events";
import {
  attachmentStorageKey,
  removeAttachment,
  storeAttachment,
} from "@/lib/file-storage";
import { createId, isTrustedRequest, readSessionCookie } from "@/lib/security";
import {
  DomainValidationError,
  finishMutation,
  recordAudit,
  ResourceNotFoundError,
} from "@/modules/shared/mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 1024 * 1024;

interface RouteContext {
  params: Promise<{ workspaceSlug: string }>;
}

interface AttachmentTarget {
  issue_id: string;
  team_id: string;
  workspace_id: string;
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim();
  return (cleaned || "attachment").slice(0, 240);
}

function errorResponse(error: unknown) {
  const status = error instanceof AuthenticationError ? 401
    : error instanceof PermissionError ? 403
      : error instanceof ResourceNotFoundError ? 404
        : error instanceof DomainValidationError || error instanceof SyntaxError ? 400 : 500;
  if (status === 500) console.error("Attachment upload failed", error);
  return NextResponse.json<ActionResult>(
    { ok: false, error: error instanceof Error ? error.message : "Attachment upload failed." },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isTrustedRequest(request)) {
    return NextResponse.json<ActionResult>({ ok: false, error: "Cross-site request rejected." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json<ActionResult>(
      { ok: false, error: "Attachment request exceeds the 26 MB limit." },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }

  let storedKey: string | null = null;
  try {
    const session = getSessionByToken(readSessionCookie(request.cookies));
    if (!session) throw new AuthenticationError();
    const { workspaceSlug } = await context.params;
    const workspace = getOne<{ id: string }>("SELECT id FROM workspaces WHERE slug = ? COLLATE NOCASE", workspaceSlug);
    if (!workspace) throw new ResourceNotFoundError("Workspace not found.");

    const form = await request.formData();
    const file = form.get("file");
    const issueId = String(form.get("issueId") ?? "").trim();
    const commentId = String(form.get("commentId") ?? "").trim();
    if (!(file instanceof File) || file.size === 0) throw new DomainValidationError("A non-empty file is required.");
    if (file.size > MAX_FILE_BYTES) throw new DomainValidationError("Attachment exceeds the 25 MB limit.");
    if (Boolean(issueId) === Boolean(commentId)) {
      throw new DomainValidationError("Attach the file to exactly one issue or comment.");
    }

    const target = issueId
      ? getOne<AttachmentTarget>(
          `SELECT id AS issue_id, team_id, workspace_id
             FROM issues
            WHERE id = ? AND trashed_at IS NULL`,
          issueId,
        )
      : getOne<AttachmentTarget>(
          `SELECT i.id AS issue_id, i.team_id, i.workspace_id
             FROM comments c
             JOIN issues i ON i.id = c.issue_id
            WHERE c.id = ? AND c.deleted_at IS NULL AND i.trashed_at IS NULL`,
          commentId,
        );
    if (!target || target.workspace_id !== workspace.id) throw new ResourceNotFoundError("Attachment target not found.");
    requireTeamPermission(session.userId, target.team_id, "edit_issue");

    const id = createId("file");
    const createdAt = new Date().toISOString();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const storageKey = attachmentStorageKey(workspace.id, id);
    const name = safeFilename(file.name);
    const mime = (file.type || "application/octet-stream").slice(0, 160);
    const url = `/api/files/${encodeURIComponent(id)}`;

    await storeAttachment(storageKey, bytes);
    storedKey = storageKey;
    transaction((database) => {
      database.prepare(
        `INSERT INTO files(
          id, workspace_id, uploader_id, storage_key, name, url, size, mime, checksum, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, workspace.id, session.userId, storageKey, name, url, file.size, mime, checksum, createdAt);
      if (issueId) {
        database.prepare("INSERT INTO issue_attachments(issue_id, file_id) VALUES (?, ?)").run(issueId, id);
      } else {
        database.prepare("INSERT INTO comment_attachments(comment_id, file_id) VALUES (?, ?)").run(commentId, id);
      }
      finishMutation(database, {
        workspaceId: workspace.id,
        actorId: session.userId,
        entityType: "issue",
        entityId: target.issue_id,
        eventType: "attachment.created",
        action: "attachment.added",
        metadata: { fileId: id, name, size: file.size },
        createdAt,
      });
      recordAudit(database, {
        workspaceId: workspace.id,
        actorId: session.userId,
        action: "attachment.created",
        entityType: "file",
        entityId: id,
        metadata: { issueId: target.issue_id, name, size: file.size, checksum },
        createdAt,
      });
    });

    const attachment: Attachment = {
      id,
      issueId: issueId || null,
      commentId: commentId || null,
      userId: session.userId,
      name,
      url,
      size: file.size,
      mime,
      createdAt,
    };
    publishWorkspaceEvent({
      workspaceId: workspace.id,
      type: "attachment.created",
      resourceId: target.issue_id,
      actorId: session.userId,
    });
    storedKey = null;
    return NextResponse.json<ActionResult<Attachment>>(
      { ok: true, data: attachment },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (storedKey) await removeAttachment(storedKey).catch(() => undefined);
    return errorResponse(error);
  }
}
