import { NextResponse, type NextRequest } from "next/server";

import { AuthenticationError, getSessionByToken, PermissionError } from "@/lib/auth";
import { getOne } from "@/lib/db";
import type { ActionResult } from "@/lib/domain";
import { isTrustedRequest, readSessionCookie } from "@/lib/security";
import {
  importWorkspaceData,
  type DataFormat,
  type DataImportResult,
} from "@/modules/data-transfer/service";
import { DomainValidationError, ResourceNotFoundError } from "@/modules/shared/mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ workspaceSlug: string }>;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;

function inferredFormat(filename: string, requested: FormDataEntryValue | null): DataFormat {
  if (requested === "json" || requested === "csv") return requested;
  return filename.toLocaleLowerCase().endsWith(".csv") ? "csv" : "json";
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isTrustedRequest(request)) {
    return NextResponse.json<ActionResult>({ ok: false, error: "Cross-site request rejected." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json<ActionResult>(
      { ok: false, error: "Import request exceeds the 21 MB limit." },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const session = getSessionByToken(readSessionCookie(request.cookies));
    if (!session) throw new AuthenticationError();
    const { workspaceSlug } = await context.params;
    const workspace = getOne<{ id: string }>("SELECT id FROM workspaces WHERE slug = ? COLLATE NOCASE", workspaceSlug);
    if (!workspace) throw new ResourceNotFoundError("Workspace not found.");

    let payload: { format: DataFormat; filename: string; content: string };
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new DomainValidationError("A JSON or CSV file is required.");
      if (file.size > MAX_UPLOAD_BYTES) throw new DomainValidationError("Import file exceeds 20 MB.");
      payload = {
        format: inferredFormat(file.name, form.get("format")),
        filename: file.name,
        content: await file.text(),
      };
    } else {
      payload = await request.json() as typeof payload;
    }
    const data = importWorkspaceData(workspace.id, session.userId, payload);
    return NextResponse.json<ActionResult<DataImportResult>>(
      { ok: true, data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof AuthenticationError ? 401
      : error instanceof PermissionError ? 403
        : error instanceof ResourceNotFoundError ? 404
          : error instanceof DomainValidationError || error instanceof SyntaxError ? 400 : 500;
    if (status === 500) console.error("Workspace import failed", error);
    return NextResponse.json<ActionResult>(
      { ok: false, error: error instanceof Error ? error.message : "Import failed." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
