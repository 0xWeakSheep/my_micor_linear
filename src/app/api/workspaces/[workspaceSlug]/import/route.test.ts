// @vitest-environment node

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "./route";

describe("workspace import request limits", () => {
  it("rejects an oversized request before authentication or parsing", async () => {
    const response = await POST(
      new NextRequest("https://micro-linear.test/api/workspaces/test/import", {
        method: "POST",
        headers: {
          "Content-Length": String(22 * 1024 * 1024),
          "Content-Type": "multipart/form-data; boundary=test",
          Origin: "https://micro-linear.test",
        },
        body: "--test--",
      }),
      { params: Promise.resolve({ workspaceSlug: "test" }) },
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/21 MB limit/),
    });
  });
});
