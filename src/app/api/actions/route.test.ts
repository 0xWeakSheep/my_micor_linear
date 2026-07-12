// @vitest-environment node

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { actionErrorDetails, POST } from "./route";

describe("action request observability", () => {
  it("adds request correlation to an early cross-site rejection", async () => {
    const response = await POST(
      new NextRequest("https://micro-linear.test/api/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "cross-site",
          "X-Request-Id": "reverse-proxy-123",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("x-request-id")).toBe("reverse-proxy-123");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("does not expose internal database errors to callers", () => {
    expect(
      actionErrorDetails(
        new Error("UNIQUE constraint failed: cycles.team_id, cycles.number"),
      ),
    ).toEqual({ status: 500, message: "Action failed." });
  });
});
