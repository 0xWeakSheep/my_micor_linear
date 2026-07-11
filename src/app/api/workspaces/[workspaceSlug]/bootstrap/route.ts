import { NextResponse, type NextRequest } from "next/server";

import type { ActionResult, BootstrapData } from "@/lib/domain";
import { getSessionByToken } from "@/lib/auth";
import {
  BootstrapNotFoundError,
  BootstrapPermissionError,
  ensureSeedData,
  getBootstrapData,
} from "@/lib/bootstrap";
import { readSessionCookie } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BootstrapRouteContext {
  readonly params: Promise<{ workspaceSlug: string }>;
}

function errorResponse(message: string, status: number): NextResponse<ActionResult> {
  return NextResponse.json(
    { ok: false, error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest, context: BootstrapRouteContext) {
  try {
    // This is intentionally before auth so a pristine local install is usable on its first request.
    ensureSeedData();

    const session = getSessionByToken(readSessionCookie(request.cookies));
    if (!session) return errorResponse("Authentication required.", 401);

    const { workspaceSlug } = await context.params;
    if (!workspaceSlug.trim()) return errorResponse("Workspace not found.", 404);

    const data = getBootstrapData(session.userId, workspaceSlug);
    return NextResponse.json<ActionResult<BootstrapData>>(
      { ok: true, data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof BootstrapNotFoundError) {
      return errorResponse(error.message, error.status);
    }
    if (error instanceof BootstrapPermissionError) {
      return errorResponse(error.message, error.status);
    }
    console.error("Workspace bootstrap failed", error);
    return errorResponse("Unable to load workspace data.", 500);
  }
}
