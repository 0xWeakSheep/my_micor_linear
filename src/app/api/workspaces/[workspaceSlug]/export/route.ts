import { NextResponse, type NextRequest } from "next/server";

import { AuthenticationError, getSessionByToken, PermissionError } from "@/lib/auth";
import { getOne } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "@/lib/security";
import { exportWorkspaceData } from "@/modules/data-transfer/service";
import { DomainValidationError, ResourceNotFoundError } from "@/modules/shared/mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ workspaceSlug: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionByToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
    if (!session) throw new AuthenticationError();
    const { workspaceSlug } = await context.params;
    const workspace = getOne<{ id: string }>(
      "SELECT id FROM workspaces WHERE slug = ? COLLATE NOCASE",
      workspaceSlug,
    );
    if (!workspace) throw new ResourceNotFoundError("Workspace not found.");
    const format = request.nextUrl.searchParams.get("format") ?? "json";
    const exported = exportWorkspaceData(workspace.id, session.userId, {
      format,
      scope: "workspace",
    });
    return new Response(exported.content, {
      headers: {
        "Content-Type": exported.mime,
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status = error instanceof AuthenticationError ? 401
      : error instanceof PermissionError ? 403
        : error instanceof ResourceNotFoundError ? 404
          : error instanceof DomainValidationError ? 400 : 500;
    if (status === 500) console.error("Workspace export failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Export failed." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
