import { describe, expect, it } from "vitest";

import {
  observeRequest,
  requestIdFor,
  structuredLog,
  type StructuredLogEntry,
} from "./observability";

describe("request identifiers", () => {
  it("preserves a safe upstream request id and rejects unsafe shapes", () => {
    expect(
      requestIdFor(
        new Request("https://micro-linear.test/api/health", {
          headers: { "X-Request-Id": "edge_01J2Y5R0H72K" },
        }),
      ),
    ).toBe("edge_01J2Y5R0H72K");

    const generated = requestIdFor(
      new Request("https://micro-linear.test/api/health", {
        headers: { "X-Request-Id": "short" },
      }),
    );
    expect(generated).toMatch(/^req_[a-f0-9]{32}$/);
  });

  it("derives a request id from a valid traceparent", () => {
    expect(
      requestIdFor(
        new Request("https://micro-linear.test/api/v1/issues", {
          headers: {
            traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
          },
        }),
      ),
    ).toBe("req_4bf92f3577b34da6a3ce929d0e0e4736");
  });
});

describe("structured logging", () => {
  it("emits one-line JSON and safely serializes errors, bigint and cycles", () => {
    const lines: string[] = [];
    const entries: StructuredLogEntry[] = [];
    const circular: Record<string, unknown> = { value: BigInt(7) };
    circular.self = circular;
    const entry = structuredLog(
      "error",
      "operation.failed",
      { circular, error: new TypeError("boom") },
      {
        now: new Date("2026-07-11T00:00:00.000Z"),
        sink: (line, value) => {
          lines.push(line);
          entries.push(value);
        },
      },
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(JSON.parse(lines[0]!) as object).toEqual(entry);
    expect(entries[0]).toMatchObject({
      timestamp: "2026-07-11T00:00:00.000Z",
      level: "error",
      event: "operation.failed",
      circular: { value: "7", self: "[Circular]" },
      error: { name: "TypeError", message: "boom" },
    });
  });

  it("records request duration and response request-id exactly once", () => {
    const entries: StructuredLogEntry[] = [];
    const times = [100, 112.345, 999];
    const observation = observeRequest(
      new Request("https://micro-linear.test/api/actions?token=never-log-this", {
        method: "POST",
        headers: { "X-Request-Id": "gateway-request-123" },
      }),
      "actions.execute",
      {
        now: new Date("2026-07-11T00:00:00.000Z"),
        monotonicNow: () => times.shift() ?? 999,
        sink: (_line, entry) => entries.push(entry),
      },
    );
    const response = observation.withResponseHeaders(new Response(null, { status: 201 }));
    observation.complete(201, { workspaceId: "workspace_1" });
    observation.complete(500, { shouldNotAppear: true });

    expect(response.headers.get("x-request-id")).toBe("gateway-request-123");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      event: "http.request.completed",
      requestId: "gateway-request-123",
      operation: "actions.execute",
      method: "POST",
      path: "/api/actions",
      status: 201,
      durationMs: 12.34,
      workspaceId: "workspace_1",
    });
    expect(JSON.stringify(entries[0])).not.toContain("token");
  });
});
