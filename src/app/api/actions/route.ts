import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthenticationError, PermissionError, requireCurrentSession } from "@/lib/auth";
import { executeAction } from "@/lib/action-service";
import type { ActionResult } from "@/lib/domain";
import { observeRequest } from "@/lib/observability";
import { isTrustedRequest } from "@/lib/security";
import {
  ConflictError,
  DomainValidationError,
  ResourceNotFoundError,
} from "@/modules/shared/mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const envelopeSchema = z
  .object({
    action: z.string().min(1).max(120),
    workspaceId: z.string().min(1).max(120),
    payload: z.unknown(),
  })
  .strict();

export function actionErrorDetails(error: unknown): { status: number; message: string } {
  const status =
    error instanceof AuthenticationError
      ? 401
      : error instanceof PermissionError
        ? 403
        : error instanceof ResourceNotFoundError
          ? 404
          : error instanceof ConflictError
            ? 409
            : error instanceof DomainValidationError
              ? error.status
              : error instanceof SyntaxError
                ? 400
                : 500;
  return {
    status,
    message:
      status >= 500
        ? "Action failed."
        : error instanceof Error
          ? error.message
          : "Action failed.",
  };
}

export async function POST(request: NextRequest) {
  const observation = observeRequest(request, "actions.execute");
  let action: string | undefined;
  let workspaceId: string | undefined;
  let actorId: string | undefined;
  if (!isTrustedRequest(request)) {
    const response = NextResponse.json<ActionResult>(
      { ok: false, error: "Cross-site request rejected." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
    observation.complete(403, { reason: "cross_site" });
    return observation.withResponseHeaders(response);
  }

  try {
    const session = await requireCurrentSession();
    actorId = session.userId;
    const parsed = envelopeSchema.safeParse(await request.json());
    if (!parsed.success) {
      const response = NextResponse.json<ActionResult>(
        { ok: false, error: "Invalid action request." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
      observation.complete(400, { actorId, reason: "invalid_envelope" });
      return observation.withResponseHeaders(response);
    }
    action = parsed.data.action;
    workspaceId = parsed.data.workspaceId;
    const data = executeAction(
      parsed.data.action,
      parsed.data.workspaceId,
      session.userId,
      parsed.data.payload,
    );
    const response = NextResponse.json<ActionResult>(
      { ok: true, data },
      { headers: { "Cache-Control": "no-store" } },
    );
    observation.complete(200, { action, workspaceId, actorId });
    return observation.withResponseHeaders(response);
  } catch (error) {
    const { status, message } = actionErrorDetails(error);
    if (status >= 500) console.error("Action request failed", error);
    const response = NextResponse.json<ActionResult>(
      { ok: false, error: message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
    observation.complete(
      status,
      {
        ...(action ? { action } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...(actorId ? { actorId } : {}),
        errorType: error instanceof Error ? error.name : "UnknownError",
      },
      status >= 500 ? error : undefined,
    );
    return observation.withResponseHeaders(response);
  }
}
