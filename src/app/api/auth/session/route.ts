import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { ActionResult } from "@/lib/domain";
import { getSessionByToken } from "@/lib/auth";
import { readSessionCookie } from "@/lib/security";

import type { AuthResponseData } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = getSessionByToken(readSessionCookie(request.cookies));
  if (!session) {
    return NextResponse.json<ActionResult>(
      { ok: false, error: "Authentication required." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json<ActionResult<AuthResponseData>>(
    {
      ok: true,
      data: { user: session.user, expiresAt: session.expiresAt },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
