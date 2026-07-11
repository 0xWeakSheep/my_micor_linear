import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  clearLoginFailures,
  createSession,
  getCredentialByEmail,
  isLoginRateLimited,
  recordFailedLogin,
} from "@/lib/auth";
import { normalizeEmail, verifyPasswordOrDummy } from "@/lib/security";

import {
  errorResponse,
  rejectUntrustedRequest,
  requestMetadata,
  sessionResponse,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();

export async function POST(request: NextRequest) {
  const rejected = rejectUntrustedRequest(request);
  if (rejected) return rejected;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const parsed = loginSchema.safeParse(payload);
  if (!parsed.success) return errorResponse("Enter a valid email and password.", 400);

  const email = normalizeEmail(parsed.data.email);
  if (isLoginRateLimited(email)) {
    return errorResponse("Too many sign-in attempts. Try again in a few minutes.", 429);
  }

  const credential = getCredentialByEmail(email);
  const passwordMatches = await verifyPasswordOrDummy(
    parsed.data.password,
    credential?.password_hash ?? null,
  );
  if (!credential || credential.disabled_at || !passwordMatches) {
    recordFailedLogin(email);
    return errorResponse("Invalid email or password.", 401);
  }

  clearLoginFailures(email);
  const session = createSession(credential.id, requestMetadata(request));
  return sessionResponse(session);
}
