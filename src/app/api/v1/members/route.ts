import type { NextRequest } from "next/server";

import { apiV1Page, getApiV1MemberPage, withApiV1 } from "@/lib/api-v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  return withApiV1(request, "workspace:read", (context) => {
    const page = getApiV1MemberPage(request, context);
    return apiV1Page(page.data, context, page.pageInfo);
  });
}
