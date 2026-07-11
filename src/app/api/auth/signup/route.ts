import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  createSession,
  createSignupAccount,
  isWorkspaceSignupAllowed,
} from "@/lib/auth";
import {
  hashPassword,
  isPlausibleEmail,
  normalizeDisplayName,
  normalizeEmail,
  validatePassword,
} from "@/lib/security";

import {
  errorResponse,
  isUniqueConstraintError,
  rejectUntrustedRequest,
  requestMetadata,
  sessionResponse,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const signupSchema = z
  .object({
    name: z.string().min(1).max(80),
    email: z.string().min(1).max(254),
    password: z.string().min(1).max(128),
    workspaceName: z.string().min(1).max(80).optional(),
    workspaceSlug: z.string().min(1).max(48).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const rejected = rejectUntrustedRequest(request);
  if (rejected) return rejected;
  if (!isWorkspaceSignupAllowed()) {
    return errorResponse("Public signup is disabled. Ask a workspace administrator for an invitation link.", 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const parsed = signupSchema.safeParse(payload);
  if (!parsed.success) return errorResponse("Check the account details and try again.", 400);

  const name = normalizeDisplayName(parsed.data.name);
  const email = normalizeEmail(parsed.data.email);
  const passwordError = validatePassword(parsed.data.password);
  if (name.length < 2) return errorResponse("Name must be at least 2 characters.", 400);
  if (!isPlausibleEmail(email)) return errorResponse("Enter a valid email address.", 400);
  if (passwordError) return errorResponse(passwordError, 400);

  const passwordHash = await hashPassword(parsed.data.password);
  try {
    const user = createSignupAccount({
      name,
      email,
      passwordHash,
      workspaceName: parsed.data.workspaceName
        ? normalizeDisplayName(parsed.data.workspaceName)
        : undefined,
      workspaceSlug: parsed.data.workspaceSlug,
    });
    const session = createSession(user.id, requestMetadata(request));
    return sessionResponse(session, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return errorResponse("An account with this email already exists.", 409);
    }
    console.error("Account signup failed", error);
    return errorResponse("Unable to create the account.", 500);
  }
}
