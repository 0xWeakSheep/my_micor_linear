import type { NextRequest } from "next/server";

import { apiV1List, getApiV1WorkspaceData, withApiV1 } from "@/lib/api-v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  return withApiV1(request, "workspace:read", (context) => {
    const { teams } = getApiV1WorkspaceData(context);
    return apiV1List(teams, context);
  });
}
