// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { closeDatabase, getDatabase } from "@/lib/db";
import { ResourceNotFoundError } from "@/modules/shared/mutation";
import { executeWorkspaceAction } from "./service";

const CREATED_AT = "2026-07-11T00:00:00.000Z";
let directory = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "micro-linear-workspaces-"));
  vi.stubEnv("MICRO_LINEAR_DB_PATH", join(directory, "workspaces.db"));
  const database = getDatabase();
  database
    .prepare(
      `INSERT INTO users(id, name, email, timezone, locale, created_at, updated_at)
       VALUES
         ('usr_actor', 'Actor', 'actor@example.com', 'UTC', 'en', ?, ?),
         ('usr_private', 'Private member', 'private@example.com', 'UTC', 'en', ?, ?)`,
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
         ('wm_actor', 'ws_test', 'usr_actor', 'admin', 'active', ?),
         ('wm_private', 'ws_test', 'usr_private', 'member', 'active', ?)`,
    )
    .run(CREATED_AT, CREATED_AT);
  database
    .prepare(
      `INSERT INTO teams(
         id, workspace_id, name, key, description, color, icon, is_private,
         next_issue_number, created_at, updated_at
       ) VALUES (
         'team_private', 'ws_test', 'Private', 'PRI', '', '#111111', 'P', 1,
         1, ?, ?
       )`,
    )
    .run(CREATED_AT, CREATED_AT);
  database
    .prepare(
      `INSERT INTO team_members(team_id, user_id, role, joined_at)
       VALUES ('team_private', 'usr_private', 'lead', ?)`,
    )
    .run(CREATED_AT);
  database
    .prepare(
      `INSERT INTO projects(
         id, workspace_id, team_id, name, slug, status, color, icon,
         created_at, updated_at
       ) VALUES (
         'project_private', 'ws_test', 'team_private', 'Private project',
         'private-project', 'started', '#222222', 'P', ?, ?
       )`,
    )
    .run(CREATED_AT, CREATED_AT);
  database
    .prepare("INSERT INTO project_teams(project_id, team_id) VALUES (?, ?)")
    .run("project_private", "team_private");
  database
    .prepare(
      `INSERT INTO documents(
         id, workspace_id, project_id, title, content, creator_id, created_at, updated_at
       ) VALUES (
         'doc_private', 'ws_test', 'project_private', 'Private notes',
         'confidential', 'usr_private', ?, ?
       )`,
    )
    .run(CREATED_AT, CREATED_AT);
});

afterAll(() => {
  closeDatabase();
  vi.unstubAllEnvs();
  rmSync(directory, { force: true, recursive: true });
});

describe("project document visibility", () => {
  it("does not expose or modify a document from an inaccessible private project", () => {
    expect(() =>
      executeWorkspaceAction("document.update", "ws_test", "usr_actor", {
        documentId: "doc_private",
        changes: { content: "overwritten" },
      }),
    ).toThrow(ResourceNotFoundError);

    const database = getDatabase();
    expect(
      database.prepare("SELECT content FROM documents WHERE id = 'doc_private'").get(),
    ).toEqual({ content: "confidential" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM activities").get()).toEqual({
      count: 0,
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM outbox_events").get()).toEqual({
      count: 0,
    });
  });

  it("does not create a document in an inaccessible private project", () => {
    expect(() =>
      executeWorkspaceAction("document.create", "ws_test", "usr_actor", {
        projectId: "project_private",
        title: "Injected notes",
        content: "should not exist",
      }),
    ).toThrow(ResourceNotFoundError);
    expect(
      getDatabase().prepare("SELECT COUNT(*) AS count FROM documents").get(),
    ).toEqual({ count: 1 });
  });
});

describe("webhook endpoint validation", () => {
  it("rejects endpoints that cannot be delivered safely", () => {
    for (const url of [
      "http://hooks.example.com/events",
      "https://user:secret@hooks.example.com/events",
      "https://hooks.example.com/events#fragment",
    ]) {
      expect(() =>
        executeWorkspaceAction("webhook.create", "ws_test", "usr_actor", {
          name: "Unsafe hook",
          url,
          events: ["issue.created"],
        }),
      ).toThrow();
    }
    expect(getDatabase().prepare("SELECT COUNT(*) AS count FROM webhooks").get()).toEqual({
      count: 0,
    });
  });
});
