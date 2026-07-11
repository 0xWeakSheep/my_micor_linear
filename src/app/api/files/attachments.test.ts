// @vitest-environment node

import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DELETE, GET } from "@/app/api/files/[fileId]/route";
import { POST } from "@/app/api/workspaces/[workspaceSlug]/attachments/route";
import { closeDatabase, getDatabase } from "@/lib/db";
import { hashOpaqueToken, SESSION_COOKIE_NAME } from "@/lib/security";

const SESSION_TOKEN = "attachment-test-session";
const CREATED_AT = "2026-07-01T00:00:00.000Z";
let temporaryDirectory = "";
let uploadDirectory = "";

function authenticatedRequest(
  url: string,
  init: { body?: BodyInit; headers?: HeadersInit; method?: string } = {},
): NextRequest {
  const headers = new Headers(init.headers);
  headers.set("Cookie", `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`);
  headers.set("Origin", "http://micro-linear.test");
  return new NextRequest(url, { ...init, headers });
}

beforeAll(async () => {
  closeDatabase();
  temporaryDirectory = await mkdtemp(join(tmpdir(), "micro-linear-attachments-"));
  uploadDirectory = join(temporaryDirectory, "uploads");
  vi.stubEnv("MICRO_LINEAR_DB_PATH", join(temporaryDirectory, "attachments.db"));
  vi.stubEnv("MICRO_LINEAR_UPLOAD_DIR", uploadDirectory);
  vi.stubEnv("APP_URL", "http://micro-linear.test");
  vi.stubEnv("AUTH_TOKEN_PEPPER", "attachment-test-pepper");

  const database = getDatabase();
  database.exec(`
    INSERT INTO users(id, name, email, timezone, locale, created_at, updated_at)
    VALUES ('user_attachment', 'Attachment User', 'attachment@micro-linear.test', 'UTC', 'en', '${CREATED_AT}', '${CREATED_AT}');
    INSERT INTO sessions(id, user_id, token_hash, expires_at, last_seen_at, created_at)
    VALUES (
      'session_attachment', 'user_attachment', '${hashOpaqueToken(SESSION_TOKEN)}',
      '2030-01-01T00:00:00.000Z', '${CREATED_AT}', '${CREATED_AT}'
    );
    INSERT INTO workspaces(id, name, slug, icon, timezone, settings_json, created_at, updated_at)
    VALUES ('workspace_attachment', 'Attachment Workspace', 'attachments', 'A', 'UTC', '{}', '${CREATED_AT}', '${CREATED_AT}');
    INSERT INTO workspace_members(id, workspace_id, user_id, role, status, joined_at)
    VALUES ('membership_attachment', 'workspace_attachment', 'user_attachment', 'admin', 'active', '${CREATED_AT}');
    INSERT INTO teams(
      id, workspace_id, name, key, description, color, icon, is_private,
      next_issue_number, created_at, updated_at
    ) VALUES (
      'team_attachment', 'workspace_attachment', 'Files', 'FIL', '', '#5E6AD2', 'F', 0,
      2, '${CREATED_AT}', '${CREATED_AT}'
    );
    INSERT INTO workflow_states(id, team_id, name, type, color, position, is_default, created_at)
    VALUES ('state_attachment', 'team_attachment', 'Todo', 'unstarted', '#888888', 100, 1, '${CREATED_AT}');
    INSERT INTO issues(
      id, workspace_id, team_id, identifier, number, title, status_id,
      creator_id, created_at, updated_at
    ) VALUES (
      'issue_attachment', 'workspace_attachment', 'team_attachment', 'FIL-1', 1,
      'Verify attachments', 'state_attachment', 'user_attachment', '${CREATED_AT}', '${CREATED_AT}'
    );
  `);
});

afterAll(async () => {
  closeDatabase();
  vi.unstubAllEnvs();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("authorized attachment storage", () => {
  it("uploads, downloads, protects and deletes an issue attachment", async () => {
    const form = new FormData();
    form.set("issueId", "issue_attachment");
    form.set("file", new File(["attachment payload"], "verification.txt", { type: "text/plain" }));
    const upload = await POST(
      authenticatedRequest("http://micro-linear.test/api/workspaces/attachments/attachments", {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ workspaceSlug: "attachments" }) },
    );
    const uploaded = await upload.json() as { data: { id: string; name: string; url: string } };

    expect(upload.status).toBe(201);
    expect(uploaded.data.name).toBe("verification.txt");
    await expect(access(join(uploadDirectory, "workspace_attachment", uploaded.data.id))).resolves.toBeUndefined();

    const download = await GET(
      authenticatedRequest(`http://micro-linear.test${uploaded.data.url}`),
      { params: Promise.resolve({ fileId: uploaded.data.id }) },
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("verification.txt");
    await expect(download.text()).resolves.toBe("attachment payload");

    const unauthorized = await GET(
      new NextRequest(`http://micro-linear.test${uploaded.data.url}`),
      { params: Promise.resolve({ fileId: uploaded.data.id }) },
    );
    expect(unauthorized.status).toBe(401);

    const removed = await DELETE(
      authenticatedRequest(`http://micro-linear.test${uploaded.data.url}`, { method: "DELETE" }),
      { params: Promise.resolve({ fileId: uploaded.data.id }) },
    );
    expect(removed.status).toBe(200);
    await expect(access(join(uploadDirectory, "workspace_attachment", uploaded.data.id))).rejects.toThrow();
  });
});
