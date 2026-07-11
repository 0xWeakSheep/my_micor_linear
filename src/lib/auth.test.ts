// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getAccessibleTeams,
  getTeamPermissionContext,
  hasTeamPermission,
  isWorkspaceSignupAllowed,
} from "@/lib/auth";
import { closeDatabase, getDatabase } from "@/lib/db";

const CREATED_AT = "2026-07-01T00:00:00.000Z";
let temporaryDirectory = "";

beforeAll(() => {
  closeDatabase();
  temporaryDirectory = mkdtempSync(join(tmpdir(), "micro-linear-auth-access-"));
  vi.stubEnv("MICRO_LINEAR_DB_PATH", join(temporaryDirectory, "auth.db"));

  expect(isWorkspaceSignupAllowed()).toBe(true);
  const database = getDatabase();
  database.exec(`
    INSERT INTO users(id, name, email, timezone, locale, created_at, updated_at)
    VALUES
      ('user_admin', 'Admin', 'admin@micro-linear.test', 'UTC', 'en', '${CREATED_AT}', '${CREATED_AT}'),
      ('user_member', 'Member', 'member@micro-linear.test', 'UTC', 'en', '${CREATED_AT}', '${CREATED_AT}'),
      ('user_guest', 'Guest', 'guest@micro-linear.test', 'UTC', 'en', '${CREATED_AT}', '${CREATED_AT}');
    INSERT INTO workspaces(id, name, slug, icon, timezone, settings_json, created_at, updated_at)
    VALUES ('workspace_access', 'Access', 'access', 'A', 'UTC', '{}', '${CREATED_AT}', '${CREATED_AT}');
    INSERT INTO workspace_members(id, workspace_id, user_id, role, status, joined_at)
    VALUES
      ('membership_admin', 'workspace_access', 'user_admin', 'admin', 'active', '${CREATED_AT}'),
      ('membership_member', 'workspace_access', 'user_member', 'member', 'active', '${CREATED_AT}'),
      ('membership_guest', 'workspace_access', 'user_guest', 'guest', 'active', '${CREATED_AT}');
    INSERT INTO teams(
      id, workspace_id, name, key, description, color, icon, is_private,
      next_issue_number, created_at, updated_at
    ) VALUES
      ('team_public', 'workspace_access', 'Public', 'PUB', '', '#555555', 'P', 0, 1, '${CREATED_AT}', '${CREATED_AT}'),
      ('team_private', 'workspace_access', 'Private', 'PRI', '', '#555555', 'R', 1, 1, '${CREATED_AT}', '${CREATED_AT}');
    INSERT INTO team_members(team_id, user_id, role, joined_at)
    VALUES ('team_private', 'user_member', 'member', '${CREATED_AT}');
  `);
});

afterAll(() => {
  closeDatabase();
  vi.unstubAllEnvs();
  rmSync(temporaryDirectory, { force: true, recursive: true });
});

describe("workspace signup policy", () => {
  it("allows only the first workspace unless public signup is explicitly enabled", () => {
    expect(isWorkspaceSignupAllowed()).toBe(false);
    vi.stubEnv("MICRO_LINEAR_ALLOW_PUBLIC_SIGNUP", "1");
    expect(isWorkspaceSignupAllowed()).toBe(true);
    vi.stubEnv("MICRO_LINEAR_ALLOW_PUBLIC_SIGNUP", "0");
  });
});

describe("private team access", () => {
  it("does not grant a workspace admin implicit access to private team content", () => {
    expect(getAccessibleTeams("user_admin", "workspace_access").map((team) => team.id)).toEqual([
      "team_public",
    ]);
    expect(hasTeamPermission(getTeamPermissionContext("user_admin", "team_private"), "read")).toBe(false);
    expect(hasTeamPermission(getTeamPermissionContext("user_admin", "team_public"), "manage")).toBe(true);
  });

  it("allows explicit private-team members while keeping guests out of public teams by default", () => {
    expect(getAccessibleTeams("user_member", "workspace_access").map((team) => team.id).sort()).toEqual([
      "team_private",
      "team_public",
    ]);
    expect(hasTeamPermission(getTeamPermissionContext("user_member", "team_private"), "edit_issue")).toBe(true);
    expect(getAccessibleTeams("user_guest", "workspace_access")).toEqual([]);
  });
});
