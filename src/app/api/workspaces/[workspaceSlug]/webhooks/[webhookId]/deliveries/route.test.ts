// @vitest-environment node

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "./route";

describe("webhook delivery history route", () => {
  it("requires authentication and disables caching", async () => {
    const response = await GET(
      new NextRequest(
        "https://micro-linear.test/api/workspaces/test/webhooks/hook/deliveries",
      ),
      { params: Promise.resolve({ workspaceSlug: "test", webhookId: "hook" }) },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Authentication required.",
    });
  });
});
