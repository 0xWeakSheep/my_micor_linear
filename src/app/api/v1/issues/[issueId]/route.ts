import type { NextRequest } from "next/server";

import { apiV1Data, getApiV1WorkspaceData, withApiV1 } from "@/lib/api-v1";
import type { Issue } from "@/lib/domain";
import { publishWorkspaceEvent } from "@/lib/events";
import { executeIssueAction } from "@/modules/issues/service";
import {
  type MutationResult,
  ResourceNotFoundError,
} from "@/modules/shared/mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface IssueRouteContext {
  readonly params: Promise<{ issueId: string }>;
}

export async function GET(
  request: NextRequest,
  routeContext: IssueRouteContext,
): Promise<Response> {
  return withApiV1(request, "issues:read", async (context) => {
    const { issueId } = await routeContext.params;
    const issue = getApiV1WorkspaceData(context).issues.find(
      (candidate) =>
        !candidate.trashedAt &&
        (candidate.id === issueId ||
          candidate.identifier.toLowerCase() === issueId.toLowerCase()),
    );
    if (!issue) throw new ResourceNotFoundError("Issue not found.");
    return apiV1Data(issue);
  });
}

export async function PATCH(
  request: NextRequest,
  routeContext: IssueRouteContext,
): Promise<Response> {
  return withApiV1(request, "issues:write", async (context) => {
    const { issueId } = await routeContext.params;
    const issue = getApiV1WorkspaceData(context).issues.find(
      (candidate) =>
        !candidate.trashedAt &&
        (candidate.id === issueId ||
          candidate.identifier.toLowerCase() === issueId.toLowerCase()),
    );
    if (!issue) throw new ResourceNotFoundError("Issue not found.");
    const changes: unknown = await request.json();
    const result = executeIssueAction(
      "issue.update",
      context.workspaceId,
      context.userId,
      { issueId: issue.id, changes },
    ) as MutationResult<Issue>;
    publishWorkspaceEvent({
      workspaceId: context.workspaceId,
      actorId: context.userId,
      type: result.eventType,
      resourceId: result.resourceId,
    });
    return apiV1Data(result.data);
  });
}
