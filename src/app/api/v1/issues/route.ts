import type { NextRequest } from "next/server";

import { apiV1Data, apiV1List, getApiV1WorkspaceData, withApiV1 } from "@/lib/api-v1";
import type { Issue } from "@/lib/domain";
import { executeIssueAction } from "@/modules/issues/service";
import type { MutationResult } from "@/modules/shared/mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  return withApiV1(request, "issues:read", (context) => {
    const { issues } = getApiV1WorkspaceData(context);
    return apiV1List(issues.filter((issue) => !issue.trashedAt), context);
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return withApiV1(request, "issues:write", async (context) => {
    const payload: unknown = await request.json();
    const result = executeIssueAction(
      "issue.create",
      context.workspaceId,
      context.userId,
      payload,
    ) as MutationResult<Issue>;
    return apiV1Data(result.data, {
      status: 201,
      headers: { Location: `/api/v1/issues/${encodeURIComponent(result.resourceId)}` },
    });
  });
}
