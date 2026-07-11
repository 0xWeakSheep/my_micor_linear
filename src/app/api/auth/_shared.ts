import { NextResponse } from "next/server";

import type { ActionResult, SessionUser } from "@/lib/domain";
import type { CreatedSession, SessionMetadata } from "@/lib/auth";
import {
  getSessionCookieOptions,
  isTrustedRequest,
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "@/lib/security";

export interface AuthResponseData {
  readonly user: SessionUser;
  readonly expiresAt: string;
}

export function requestMetadata(request: Request): SessionMetadata {
  const forwarded = request.headers.get("x-forwarded-for");
  return {
    userAgent: request.headers.get("user-agent"),
    ipAddress: forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip"),
  };
}

export function errorResponse(message: string, status: number): NextResponse<ActionResult> {
  return NextResponse.json(
    { ok: false, error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function rejectUntrustedRequest(request: Request): NextResponse<ActionResult> | null {
  return isTrustedRequest(request) ? null : errorResponse("Cross-site request rejected.", 403);
}

export function sessionResponse(session: CreatedSession, status = 200): NextResponse<ActionResult<AuthResponseData>> {
  const response = NextResponse.json<ActionResult<AuthResponseData>>(
    {
      ok: true,
      data: { user: session.user, expiresAt: session.expiresAt },
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(SESSION_COOKIE_NAME, session.token, getSessionCookieOptions());
  return response;
}

export function clearSessionCookie(response: NextResponse): void {
  const options = {
    ...getSessionCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  };
  response.cookies.set(SESSION_COOKIE_NAME, "", options);
  response.cookies.set(LEGACY_SESSION_COOKIE_NAME, "", options);
}

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}
