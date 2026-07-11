// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "@/app/api/auth/password/route";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  hashOpaqueToken,
  hashPassword,
  SESSION_COOKIE_NAME,
  verifyPassword,
} from "@/lib/security";

const CURRENT_SESSION_TOKEN = "password-current-session-token";
const CREATED_AT = "2026-07-01T00:00:00.000Z";
let temporaryDirectory = "";

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://micro-linear.test/api/auth/password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${SESSION_COOKIE_NAME}=${CURRENT_SESSION_TOKEN}`,
      Origin: "http://micro-linear.test",
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  closeDatabase();
  temporaryDirectory = mkdtempSync(join(tmpdir(), "micro-linear-password-"));
  vi.stubEnv("MICRO_LINEAR_DB_PATH", join(temporaryDirectory, "password.db"));
  vi.stubEnv("APP_URL", "http://micro-linear.test");
  vi.stubEnv("AUTH_PASSWORD_PEPPER", "password-test-pepper");
  vi.stubEnv("AUTH_TOKEN_PEPPER", "token-test-pepper");
  const passwordHash = await hashPassword("current-password");
  getDatabase().exec(`
    INSERT INTO users(id, name, email, timezone, locale, created_at, updated_at)
    VALUES ('user_password', 'Password User', 'password@micro-linear.test', 'UTC', 'en', '${CREATED_AT}', '${CREATED_AT}');
    INSERT INTO password_credentials(user_id, password_hash, password_changed_at)
    VALUES ('user_password', '${passwordHash}', '${CREATED_AT}');
    INSERT INTO workspaces(id, name, slug, icon, timezone, settings_json, created_at, updated_at)
    VALUES ('workspace_password', 'Password', 'password', 'P', 'UTC', '{}', '${CREATED_AT}', '${CREATED_AT}');
    INSERT INTO workspace_members(id, workspace_id, user_id, role, status, joined_at)
    VALUES ('membership_password', 'workspace_password', 'user_password', 'admin', 'active', '${CREATED_AT}');
    INSERT INTO sessions(id, user_id, token_hash, expires_at, last_seen_at, created_at)
    VALUES
      ('session_current', 'user_password', '${hashOpaqueToken(CURRENT_SESSION_TOKEN)}', '2030-01-01T00:00:00.000Z', '${CREATED_AT}', '${CREATED_AT}'),
      ('session_other', 'user_password', '${hashOpaqueToken("password-other-session-token")}', '2030-01-01T00:00:00.000Z', '${CREATED_AT}', '${CREATED_AT}');
  `);
});

afterAll(() => {
  closeDatabase();
  vi.unstubAllEnvs();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("password change", () => {
  it("verifies the current password, changes it, and revokes other sessions", async () => {
    const rejected = await POST(request({
      currentPassword: "wrong-password",
      newPassword: "next-password-value",
    }));
    expect(rejected.status).toBe(400);

    const changed = await POST(request({
      currentPassword: "current-password",
      newPassword: "next-password-value",
    }));
    expect(changed.status).toBe(200);
    await expect(changed.json()).resolves.toMatchObject({
      ok: true,
      data: { revokedSessions: 1 },
    });
    expect(getDatabase().prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 1 });
    const row = getDatabase()
      .prepare("SELECT password_hash AS passwordHash FROM password_credentials WHERE user_id = 'user_password'")
      .get() as { passwordHash: string };
    await expect(verifyPassword("next-password-value", row.passwordHash)).resolves.toBe(true);
    expect(
      getDatabase().prepare("SELECT action FROM audit_logs WHERE workspace_id = 'workspace_password'").get(),
    ).toEqual({ action: "account.password-changed" });
  });
});
