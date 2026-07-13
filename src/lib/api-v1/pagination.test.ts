// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  encodeApiV1Cursor,
  readApiV1Pagination,
} from "@/lib/api-v1/pagination";

type IssueCursor = readonly [updatedAt: string, id: string];

function isIssueCursor(value: unknown): value is IssueCursor {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string"
  );
}

describe("REST API v1 cursor pagination", () => {
  it("uses a bounded default and round-trips a resource cursor", () => {
    const position: IssueCursor = ["2026-07-13T00:00:00.000Z", "issue_10"];
    const cursor = encodeApiV1Cursor("issues", "ws_a", position);
    const request = new Request(
      `https://micro-linear.test/api/v1/issues?limit=25&cursor=${cursor}`,
    );

    expect(readApiV1Pagination(request, "issues", "ws_a", isIssueCursor)).toEqual({
      cursor: position,
      limit: 25,
    });
    expect(
      readApiV1Pagination(
        new Request("https://micro-linear.test/api/v1/issues"),
        "issues",
        "ws_a",
        isIssueCursor,
      ),
    ).toEqual({ cursor: null, limit: 50 });
  });

  it.each(["0", "101", "1.5", "abc"])("rejects an invalid limit of %s", (limit) => {
    expect(() =>
      readApiV1Pagination(
        new Request(`https://micro-linear.test/api/v1/issues?limit=${limit}`),
        "issues",
        "ws_a",
        isIssueCursor,
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_pagination", status: 400 }));
  });

  it("rejects malformed, duplicated, mismatched and structurally invalid cursors", () => {
    const projectCursor = encodeApiV1Cursor("projects", "ws_a", [100, "project_1"]);
    const wrongWorkspace = encodeApiV1Cursor("issues", "ws_b", [
      "2026-07-13T00:00:00.000Z",
      "issue_1",
    ]);
    const wrongShape = encodeApiV1Cursor("issues", "ws_a", [100, "issue_1"]);
    const requests = [
      new Request("https://micro-linear.test/api/v1/issues?cursor="),
      new Request("https://micro-linear.test/api/v1/issues?cursor=not%20base64"),
      new Request("https://micro-linear.test/api/v1/issues?cursor=a&cursor=b"),
      new Request(`https://micro-linear.test/api/v1/issues?cursor=${projectCursor}`),
      new Request(`https://micro-linear.test/api/v1/issues?cursor=${wrongWorkspace}`),
      new Request(`https://micro-linear.test/api/v1/issues?cursor=${wrongShape}`),
    ];

    for (const request of requests) {
      expect(() =>
        readApiV1Pagination(request, "issues", "ws_a", isIssueCursor),
      ).toThrowError(
        expect.objectContaining({ code: "invalid_pagination", status: 400 }),
      );
    }
  });
});
