// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSession } from "@/lib/auth";
import { closeDatabase, getDatabase } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "@/lib/security";
import { GET } from "./route";

const CREATED_AT = "2026-07-17T00:00:00.000Z";
let directory = "";
let adminToken = "";
let memberToken = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "micro-linear-webhook-route-"));
  vi.stubEnv("MICRO_LINEAR_DB_PATH", join(directory, "route.db"));
  const database = getDatabase();
  database
    .prepare(
      `INSERT INTO users(id, name, email, timezone, locale, created_at, updated_at)
       VALUES
         ('usr_admin', 'Admin', 'admin@example.com', 'UTC', 'en', ?, ?),
         ('usr_member', 'Member', 'member@example.com', 'UTC', 'en', ?, ?)`,
    )
    .run(CREATED_AT, CREATED_AT, CREATED_AT, CREATED_AT);
  database
    .prepare(
      `INSERT INTO workspaces(id, name, slug, icon, timezone, created_at, updated_at)
       VALUES ('ws_test', 'Test', 'test', 'T', 'UTC', ?, ?)`,
    )
    .run(CREATED_AT, CREATED_AT);
  database
    .prepare(
      `INSERT INTO workspace_members(id, workspace_id, user_id, role, status, joined_at)
       VALUES
         ('wm_admin', 'ws_test', 'usr_admin', 'admin', 'active', ?),
         ('wm_member', 'ws_test', 'usr_member', 'member', 'active', ?)`,
    )
    .run(CREATED_AT, CREATED_AT);
  database
    .prepare(
      `INSERT INTO webhooks(
        id, workspace_id, name, url, secret_hash, signing_secret_encrypted,
        events_json, is_active, created_by_id, created_at, updated_at
      ) VALUES (
        'hook_main', 'ws_test', 'Main', 'https://hooks.example.com/main',
        'hash', 'v0.dGVzdA', '["issue.updated"]', 1, 'usr_admin', ?, ?
      )`,
    )
    .run(CREATED_AT, CREATED_AT);
  database
    .prepare(
      `INSERT INTO outbox_events(
        id, workspace_id, type, aggregate_type, aggregate_id, payload_json,
        available_at, attempts, processed_at, created_at
      ) VALUES (
        'event_failed', 'ws_test', 'issue.updated', 'issue', 'issue_1', '{}',
        ?, 1, ?, ?
      )`,
    )
    .run(CREATED_AT, CREATED_AT, CREATED_AT);
  database
    .prepare(
      `INSERT INTO webhook_deliveries(
        id, webhook_id, event_id, request_body, response_status,
        response_body, attempt, created_at
      ) VALUES (
        'delivery_failed', 'hook_main', 'event_failed',
        '{"private":"request"}', 500, 'upstream failed', 1, ?
      )`,
    )
    .run(CREATED_AT);
  adminToken = createSession("usr_admin").token;
  memberToken = createSession("usr_member").token;
});

afterAll(() => {
  closeDatabase();
  vi.unstubAllEnvs();
  rmSync(directory, { force: true, recursive: true });
});

function request(path = "?limit=20", token = adminToken): NextRequest {
  return new NextRequest(
    `https://micro-linear.test/api/workspaces/test/webhooks/hook_main/deliveries${path}`,
    { headers: token ? { Cookie: `${SESSION_COOKIE_NAME}=${token}` } : {} },
  );
}

const context = {
  params: Promise.resolve({ workspaceSlug: "test", webhookId: "hook_main" }),
};

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

  it("returns bounded administrator history without request bodies", async () => {
    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      data: {
        items: [
          {
            id: "delivery_failed",
            status: "failed",
            eventType: "issue.updated",
            canReplay: true,
          },
        ],
        nextCursor: null,
      },
    });
    expect(JSON.stringify(body)).not.toContain('"private":"request"');
  });

  it("enforces administration and maps invalid queries and missing hooks", async () => {
    expect((await GET(request("", memberToken), context)).status).toBe(403);
    expect((await GET(request("?limit=51"), context)).status).toBe(400);
    expect(
      (
        await GET(request(), {
          params: Promise.resolve({ workspaceSlug: "test", webhookId: "missing" }),
        })
      ).status,
    ).toBe(404);
  });
});
