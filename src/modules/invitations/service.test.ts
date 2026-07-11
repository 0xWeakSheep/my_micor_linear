// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "@/app/api/invitations/accept/route";
import { closeDatabase, getDatabase, getOne } from "@/lib/db";
import { hashOpaqueToken, SESSION_COOKIE_NAME } from "@/lib/security";

const CREATED_AT = "2026-07-01T00:00:00.000Z";
const NEW_USER_TOKEN = "inv_new_user_test_token_1234567890";
const EXISTING_USER_TOKEN = "inv_existing_user_test_token_123456";
const EXISTING_SESSION = "existing-user-session-token";
const ADMIN_SESSION = "admin-session-token";
let temporaryDirectory = "";

function request(
  body: Record<string, unknown>,
  sessionToken?: string,
): NextRequest {
  const headers = new Headers({
    "Content-Type": "application/json",
    Origin: "http://orbit.test",
  });
  if (sessionToken) headers.set("Cookie", `${SESSION_COOKIE_NAME}=${sessionToken}`);
  return new NextRequest("http://orbit.test/api/invitations/accept", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  closeDatabase();
  temporaryDirectory = mkdtempSync(join(tmpdir(), "orbit-invitations-"));
  vi.stubEnv("ORBIT_DB_PATH", join(temporaryDirectory, "invitations.db"));
  vi.stubEnv("APP_URL", "http://orbit.test");
  vi.stubEnv("AUTH_PASSWORD_PEPPER", "invitation-password-pepper");
  vi.stubEnv("AUTH_TOKEN_PEPPER", "invitation-token-pepper");
  const database = getDatabase();
  database.exec(`
    INSERT INTO users(id, name, email, timezone, locale, created_at, updated_at)
    VALUES
      ('user_admin', 'Admin', 'admin@orbit.test', 'UTC', 'en', '${CREATED_AT}', '${CREATED_AT}'),
      ('user_existing', 'Existing', 'existing@orbit.test', 'UTC', 'en', '${CREATED_AT}', '${CREATED_AT}');
    INSERT INTO workspaces(id, name, slug, icon, timezone, settings_json, created_at, updated_at)
    VALUES ('workspace_invite', 'Invite Workspace', 'invite-workspace', 'I', 'UTC', '{}', '${CREATED_AT}', '${CREATED_AT}');
    INSERT INTO workspace_members(id, workspace_id, user_id, role, status, joined_at)
    VALUES ('membership_admin', 'workspace_invite', 'user_admin', 'admin', 'active', '${CREATED_AT}');
    INSERT INTO sessions(id, user_id, token_hash, expires_at, last_seen_at, created_at)
    VALUES
      ('session_existing', 'user_existing', '${hashOpaqueToken(EXISTING_SESSION)}', '2030-01-01T00:00:00.000Z', '${CREATED_AT}', '${CREATED_AT}'),
      ('session_admin', 'user_admin', '${hashOpaqueToken(ADMIN_SESSION)}', '2030-01-01T00:00:00.000Z', '${CREATED_AT}', '${CREATED_AT}');
    INSERT INTO invitations(
      id, workspace_id, email, role, token_hash, invited_by_id, expires_at, created_at
    ) VALUES
      ('invite_new', 'workspace_invite', 'new@orbit.test', 'member', '${hashOpaqueToken(NEW_USER_TOKEN)}', 'user_admin', '2030-01-01T00:00:00.000Z', '${CREATED_AT}'),
      ('invite_existing', 'workspace_invite', 'existing@orbit.test', 'guest', '${hashOpaqueToken(EXISTING_USER_TOKEN)}', 'user_admin', '2030-01-01T00:00:00.000Z', '${CREATED_AT}');
  `);
});

afterAll(() => {
  closeDatabase();
  vi.unstubAllEnvs();
  rmSync(temporaryDirectory, { force: true, recursive: true });
});

describe("invitation acceptance", () => {
  it("creates an account, membership and authenticated session for a new email", async () => {
    const response = await POST(request({
      token: NEW_USER_TOKEN,
      name: "New Member",
      password: "invited-password",
    }));
    const body = await response.json() as { data: { redirect: string } };

    expect(response.status).toBe(201);
    expect(body.data.redirect).toBe("/invite-workspace/my-issues/assigned");
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(getOne<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = 'workspace_invite' AND u.email = 'new@orbit.test' AND wm.role = 'member'`,
    )?.count).toBe(1);
    expect(getOne<{ count: number }>(
      `SELECT COUNT(*) AS count
         FROM password_credentials pc
         JOIN users u ON u.id = pc.user_id
        WHERE u.email = 'new@orbit.test'`,
    )?.count).toBe(1);
  });

  it("requires an existing account to sign in, then accepts with the matching session", async () => {
    const signedOut = await POST(request({ token: EXISTING_USER_TOKEN }));
    expect(signedOut.status).toBe(401);

    const wrongAccount = await POST(request({ token: EXISTING_USER_TOKEN }, ADMIN_SESSION));
    expect(wrongAccount.status).toBe(409);

    const accepted = await POST(request({ token: EXISTING_USER_TOKEN }, EXISTING_SESSION));
    expect(accepted.status).toBe(200);
    expect(getOne<{ role: string }>(
      "SELECT role FROM workspace_members WHERE workspace_id = 'workspace_invite' AND user_id = 'user_existing'",
    )?.role).toBe("guest");
  });
});
