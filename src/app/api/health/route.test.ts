// @vitest-environment node

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ healthy: true }));

vi.mock("@/lib/bootstrap", () => ({ ensureSeedData: () => false }));
vi.mock("@/lib/db", () => ({
  getOne: (sql: string) => {
    if (sql.includes("quick_check")) {
      return { quick_check: state.healthy ? "ok" : "corrupt" };
    }
    return { count: 3 };
  },
}));

import { GET } from "./route";

describe("health request observability", () => {
  it("returns and propagates a safe request id", async () => {
    state.healthy = true;
    const response = GET(
      new NextRequest("https://micro-linear.test/api/health", {
        headers: { "X-Request-Id": "load-balancer-123" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("load-balancer-123");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ ok: true, migrations: 3 });
  });

  it("keeps request correlation on an unhealthy response", async () => {
    state.healthy = false;
    const response = GET(
      new NextRequest("https://micro-linear.test/api/health", {
        headers: { "X-Request-Id": "load-balancer-456" },
      }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBe("load-balancer-456");
    await expect(response.json()).resolves.toMatchObject({ ok: false, status: "unhealthy" });
  });
});
