import { NextResponse, type NextRequest } from "next/server";

import {
  AuthenticationError,
  getSessionByToken,
  PermissionError,
} from "@/lib/auth";
import type { ActionResult, WebhookDeliveryPage } from "@/lib/domain";
import { readSessionCookie } from "@/lib/security";
import {
  DomainValidationError,
  ResourceNotFoundError,
} from "@/modules/shared/mutation";
import { listWebhookDeliveries } from "@/modules/webhooks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

interface RouteContext {
  params: Promise<{ workspaceSlug: string; webhookId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionByToken(readSessionCookie(request.cookies));
    if (!session) throw new AuthenticationError();
    const { workspaceSlug, webhookId } = await context.params;
    const data = listWebhookDeliveries(
      session.userId,
      workspaceSlug,
      webhookId,
      request.nextUrl.searchParams,
    );
    return NextResponse.json<ActionResult<WebhookDeliveryPage>>(
      { ok: true, data },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const status =
      error instanceof AuthenticationError
        ? 401
        : error instanceof PermissionError
          ? 403
          : error instanceof ResourceNotFoundError
            ? 404
            : error instanceof DomainValidationError
              ? 400
              : 500;
    if (status === 500) console.error("Webhook delivery history request failed", error);
    return NextResponse.json<ActionResult>(
      {
        ok: false,
        error:
          status === 500
            ? "Unable to load webhook delivery history."
            : error instanceof Error
              ? error.message
              : "Unable to load webhook delivery history.",
      },
      { status, headers: NO_STORE_HEADERS },
    );
  }
}
