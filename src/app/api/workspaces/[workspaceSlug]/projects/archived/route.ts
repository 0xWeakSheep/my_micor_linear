import { NextResponse, type NextRequest } from "next/server";

import {
  AuthenticationError,
  getSessionByToken,
  PermissionError,
} from "@/lib/auth";
import { getOne } from "@/lib/db";
import type { ActionResult, Project } from "@/lib/domain";
import { SESSION_COOKIE_NAME } from "@/lib/security";
import { listArchivedProjects } from "@/modules/planning/service";
import { ResourceNotFoundError } from "@/modules/shared/mutation";

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
    const projects = listArchivedProjects(workspace.id, session.userId);
    return NextResponse.json<ActionResult<Project[]>>(
      { ok: true, data: projects },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof AuthenticationError
      ? 401
      : error instanceof PermissionError
        ? 403
        : error instanceof ResourceNotFoundError
          ? 404
          : 500;
    if (status === 500) console.error("Archived projects request failed", error);
    return NextResponse.json<ActionResult>(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load archived projects." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
