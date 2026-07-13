import type { NextRequest } from "next/server";

import {
  apiV1Data,
  apiV1Page,
  getApiV1IssuePage,
  readApiV1Json,
  withApiV1,
} from "@/lib/api-v1";
import type { Issue } from "@/lib/domain";
import { publishWorkspaceEvent } from "@/lib/events";
import { executeIssueAction } from "@/modules/issues/service";
import type { MutationResult } from "@/modules/shared/mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  return withApiV1(request, "issues:read", (context) => {
    const page = getApiV1IssuePage(request, context);
    return apiV1Page(page.data, context, page.pageInfo);
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return withApiV1(request, "issues:write", async (context) => {
    const payload = await readApiV1Json(request);
    const result = executeIssueAction(
      "issue.create",
      context.workspaceId,
      context.userId,
      payload,
    ) as MutationResult<Issue>;
    publishWorkspaceEvent({
      workspaceId: context.workspaceId,
      actorId: context.userId,
      type: result.eventType,
      resourceId: result.resourceId,
    });
    return apiV1Data(result.data, {
      status: 201,
      headers: { Location: `/api/v1/issues/${encodeURIComponent(result.resourceId)}` },
    });
  });
}
