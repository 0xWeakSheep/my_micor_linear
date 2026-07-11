import type { NextRequest } from "next/server";

import { requireCurrentSession, requireWorkspacePermission } from "@/lib/auth";
import { subscribeToWorkspace, type WorkspaceEvent } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export interface WorkspaceInvalidationEvent {
  id: string;
  workspaceId: string;
  type: "workspace.changed";
  revision: number;
  createdAt: string;
}

export function redactWorkspaceEvent(event: WorkspaceEvent): WorkspaceInvalidationEvent {
  return {
    id: event.id,
    workspaceId: event.workspaceId,
    type: "workspace.changed",
    revision: event.revision,
    createdAt: event.createdAt,
  };
}

function encodeEvent(event: WorkspaceInvalidationEvent): Uint8Array {
  return encoder.encode(
    `id: ${event.id}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

export async function GET(request: NextRequest) {
  const session = await requireCurrentSession();
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return Response.json({ ok: false, error: "workspaceId is required" }, { status: 400 });
  requireWorkspacePermission(session.userId, workspaceId, "read");

  let unsubscribe: () => void = () => undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`retry: 2000\nevent: ready\ndata: {"ok":true}\n\n`));
      unsubscribe = subscribeToWorkspace(workspaceId, (event) => {
        try {
          controller.enqueue(encodeEvent(redactWorkspaceEvent(event)));
        } catch {
          unsubscribe();
        }
      });
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch {
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
        }
      }, 15_000);

      request.signal.addEventListener(
        "abort",
        () => {
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // The stream may already be closed by the runtime.
          }
        },
        { once: true },
      );
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
