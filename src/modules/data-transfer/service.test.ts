// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { closeDatabase, getDatabase } from "@/lib/db";
import { ConflictError } from "@/modules/shared/mutation";
import { executeWorkspaceAction } from "@/modules/workspaces/service";
import { exportWorkspaceData, importWorkspaceData } from "./service";

let directory = "";

function fixture(): void {
  const db = getDatabase();
  db.exec("PRAGMA foreign_keys = OFF");
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'`).all() as Array<{ name: string }>;
  for (const table of tables) db.exec(`DELETE FROM "${table.name}"`);
  db.exec("PRAGMA foreign_keys = ON");
  const now = "2026-07-11T00:00:00.000Z";
  db.prepare(`INSERT INTO users(id,name,email,avatar_url,timezone,locale,disabled_at,created_at,updated_at,preferences_json) VALUES ('usr_admin','Admin','admin@example.com',NULL,'UTC','en',NULL,?,?, '{}'), ('usr_guest','Guest','guest@example.com',NULL,'UTC','en',NULL,?,?, '{}')`).run(now, now, now, now);
  db.prepare(`INSERT INTO workspaces(id,name,slug,icon,timezone,settings_json,created_at,updated_at) VALUES ('ws_test','Test','test','T','UTC','{}',?,?)`).run(now, now);
  db.prepare(`INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at) VALUES ('wm_admin','ws_test','usr_admin','admin','active',?), ('wm_guest','ws_test','usr_guest','guest','active',?)`).run(now, now);
  db.prepare(`INSERT INTO teams(id,workspace_id,name,key,description,color,icon,is_private,triage_enabled,next_issue_number,cycle_settings_json,created_at,updated_at) VALUES ('team_eng','ws_test','Engineering','ENG','','#000','E',0,0,2,'{}',?,?)`).run(now, now);
  db.prepare(`INSERT INTO team_members(team_id,user_id,role,joined_at) VALUES ('team_eng','usr_admin','lead',?)`).run(now);
  db.prepare(`INSERT INTO workflow_states(id,team_id,name,type,color,position,is_default,created_at) VALUES ('state_backlog','team_eng','Backlog','backlog','#888',100,1,?)`).run(now);
  db.prepare(`INSERT INTO issues(id,workspace_id,team_id,identifier,number,title,description,status_id,priority,creator_id,sort_order,version,created_at,updated_at) VALUES ('issue_1','ws_test','team_eng','ENG-1',1,'Existing issue','','state_backlog',2,'usr_admin',100,1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO issue_identifier_aliases(id,workspace_id,issue_id,identifier,is_current,created_at) VALUES ('alias_1','ws_test','issue_1','ENG-1',1,?)`).run(now);
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "orbit-transfer-"));
  process.env.ORBIT_DB_PATH = join(directory, "test.db");
});

beforeEach(() => fixture());

afterAll(() => {
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
  delete process.env.ORBIT_DB_PATH;
});

describe("workspace data transfer", () => {
  it("exports a sanitized JSON snapshot", () => {
    const exported = exportWorkspaceData("ws_test", "usr_admin", { format: "json", scope: "workspace" });
    const snapshot = JSON.parse(exported.content) as { schema: string; data: { issues: unknown[] } };
    expect(snapshot.schema).toBe("orbit.workspace.v1");
    expect(snapshot.data.issues).toHaveLength(1);
    expect(exported.content).not.toContain("password_hash");
    expect(exported.filename).toMatch(/test-export-.*\.json/);
  });

  it("imports CSV issues atomically and records audit data", () => {
    const result = importWorkspaceData("ws_test", "usr_admin", {
      format: "csv",
      filename: "issues.csv",
      content: "Title,Team,Priority,Labels\nImported issue,ENG,high,Bug",
    });
    expect(result.created.issues).toBe(1);
    expect(result.created.labels).toBe(1);
    const db = getDatabase();
    expect((db.prepare("SELECT COUNT(*) AS count FROM issues").get() as { count: number }).count).toBe(2);
    expect((db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'data.imported'").get() as { count: number }).count).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE type = 'data.imported'").get() as { count: number }).count).toBe(1);
  });

  it("rejects malformed imports and guest exports", () => {
    expect(() => importWorkspaceData("ws_test", "usr_admin", { format: "csv", filename: "bad.csv", content: "Name\nMissing fields" })).toThrow("requires Title and Team");
    expect(() => exportWorkspaceData("ws_test", "usr_guest", { format: "json", scope: "workspace" })).toThrow();
  });
});

describe("account update", () => {
  it("updates identity and preferences with audit records", () => {
    const result = executeWorkspaceAction("account.update", "ws_test", "usr_admin", {
      changes: { name: "Updated Admin", theme: "dark", compactRows: true },
    });
    expect(result?.data).toMatchObject({ name: "Updated Admin" });
    const row = getDatabase().prepare("SELECT preferences_json FROM users WHERE id = 'usr_admin'").get() as { preferences_json: string };
    expect(JSON.parse(row.preferences_json)).toEqual({ theme: "dark", compactRows: true });
  });

  it("rejects an email already owned by another account", () => {
    expect(() => executeWorkspaceAction("account.update", "ws_test", "usr_admin", {
      changes: { email: "guest@example.com" },
    })).toThrow(ConflictError);
  });
});
