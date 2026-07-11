import "server-only";

import { requireWorkspacePermission } from "@/lib/auth";
import { getBootstrapData } from "@/lib/bootstrap";
import type { BootstrapData } from "@/lib/domain";
import type { ApiV1Context } from "@/lib/api-v1/http";

export function getApiV1WorkspaceData(context: ApiV1Context): BootstrapData {
  requireWorkspacePermission(context.userId, context.workspaceId, "read");
  return getBootstrapData(context.userId, context.workspaceSlug);
}
