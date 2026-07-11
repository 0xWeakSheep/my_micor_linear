import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { ensureSeedData } from "@/lib/bootstrap";
import { getOne } from "@/lib/db";
import { observeRequest } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const observation = observeRequest(request, "health.check");
  try {
    const seeded = ensureSeedData();
    const integrity = getOne<{ quick_check: string }>("PRAGMA quick_check");
    const migrations = getOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM schema_migrations",
    );

    if (integrity?.quick_check !== "ok") {
      throw new Error(`SQLite quick check returned ${integrity?.quick_check ?? "no result"}`);
    }

    const response = NextResponse.json(
      {
        ok: true,
        status: "healthy",
        database: "ready",
        migrations: Number(migrations?.count ?? 0),
        seeded,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    observation.complete(200, {
      database: "ready",
      migrations: Number(migrations?.count ?? 0),
      seeded,
    });
    return observation.withResponseHeaders(response);
  } catch (error) {
    const response = NextResponse.json(
      { ok: false, status: "unhealthy", database: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
    observation.complete(503, { database: "unavailable" }, error);
    return observation.withResponseHeaders(response);
  }
}
