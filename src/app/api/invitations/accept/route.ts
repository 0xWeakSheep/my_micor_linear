import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createSession, getSessionByToken } from "@/lib/auth";
import type { ActionResult } from "@/lib/domain";
import {
  getSessionCookieOptions,
  hashPassword,
  isTrustedRequest,
  normalizeDisplayName,
  readSessionCookie,
  SESSION_COOKIE_NAME,
  validatePassword,
} from "@/lib/security";
import {
  acceptInvitationForUser,
  createAccountFromInvitation,
  getInvitationSummary,
  InvitationExpiredError,
} from "@/modules/invitations/service";
import { ConflictError, ResourceNotFoundError } from "@/modules/shared/mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  token: z.string().min(20).max(512),
  name: z.string().max(80).optional(),
  password: z.string().max(128).optional(),
}).strict();

interface AcceptInvitationResult {
  redirect: string;
}

function errorResponse(error: unknown) {
  const status = error instanceof ResourceNotFoundError ? 404
    : error instanceof InvitationExpiredError ? 410
      : error instanceof ConflictError ? 409 : 500;
  if (status === 500) console.error("Invitation acceptance failed", error);
  return NextResponse.json<ActionResult>(
    { ok: false, error: error instanceof Error ? error.message : "Unable to accept invitation." },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!isTrustedRequest(request)) {
    return NextResponse.json<ActionResult>({ ok: false, error: "Cross-site request rejected." }, { status: 403 });
  }
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json<ActionResult>({ ok: false, error: "Invalid invitation request." }, { status: 400 });
    }
    const invitation = getInvitationSummary(parsed.data.token);
    if (!invitation) throw new ResourceNotFoundError("Invitation not found.");

    const session = getSessionByToken(readSessionCookie(request.cookies));
    if (session) {
      const accepted = acceptInvitationForUser(parsed.data.token, session.userId);
      return NextResponse.json<ActionResult<AcceptInvitationResult>>(
        { ok: true, data: { redirect: `/${accepted.workspaceSlug}/my-issues/assigned` } },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (invitation.existingUser) {
      return NextResponse.json<ActionResult>(
        { ok: false, error: "An account already exists for this email. Sign in, then open the invitation link again." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const name = normalizeDisplayName(parsed.data.name ?? "");
    const password = parsed.data.password ?? "";
    const passwordError = validatePassword(password);
    if (name.length < 2 || passwordError) {
      return NextResponse.json<ActionResult>(
        { ok: false, error: name.length < 2 ? "Name must be at least 2 characters." : passwordError! },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const passwordHash = await hashPassword(password);
    const accepted = createAccountFromInvitation(parsed.data.token, { name, passwordHash });
    const createdSession = createSession(accepted.userId, {
      userAgent: request.headers.get("user-agent"),
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip"),
    });
    const response = NextResponse.json<ActionResult<AcceptInvitationResult>>(
      { ok: true, data: { redirect: `/${accepted.workspaceSlug}/my-issues/assigned` } },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(SESSION_COOKIE_NAME, createdSession.token, getSessionCookieOptions());
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
