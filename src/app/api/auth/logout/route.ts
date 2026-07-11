import { NextResponse, type NextRequest } from "next/server";

import type { ActionResult } from "@/lib/domain";
import { deleteSessionByToken } from "@/lib/auth";
import { readSessionCookie } from "@/lib/security";

import {
  clearSessionCookie,
  rejectUntrustedRequest,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rejected = rejectUntrustedRequest(request);
  if (rejected) return rejected;

  deleteSessionByToken(readSessionCookie(request.cookies));
  const response = NextResponse.json<ActionResult>(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  clearSessionCookie(response);
  return response;
}
