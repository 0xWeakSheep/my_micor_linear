// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PermissionError } from "@/lib/auth";
import { closeDatabase, getDatabase } from "@/lib/db";
import type { Comment, Issue, IssueRelation, Reaction } from "@/lib/domain";
import {
  ConflictError,
  DomainValidationError,
  type MutationResult,
} from "@/modules/shared/mutation";
import { executeIssueAction } from "./service";

let directory = "";

function fixture(): void {
  const database = getDatabase();
  database.exec("PRAGMA foreign_keys = OFF");
  const tables = database
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'`,
    )
    .all() as Array<{ name: string }>;
  for (const table of tables) database.exec(`DELETE FROM "${table.name}"`);
  database.exec("PRAGMA foreign_keys = ON");

  const now = "2026-07-11T00:00:00.000Z";
  database
    .prepare(
      `INSERT INTO users(
        id, name, email, avatar_url, timezone, locale, disabled_at,
        created_at, updated_at, preferences_json
      ) VALUES
        ('usr_author', 'Author', 'author@example.com', NULL, 'UTC', 'en', NULL, ?, ?, '{}'),
        ('usr_member', 'Member', 'member@example.com', NULL, 'UTC', 'en', NULL, ?, ?, '{}'),
        ('usr_lead', 'Lead', 'lead@example.com', NULL, 'UTC', 'en', NULL, ?, ?, '{}'),
        ('usr_admin', 'Admin', 'admin@example.com', NULL, 'UTC', 'en', NULL, ?, ?, '{}')`,
    )
    .run(now, now, now, now, now, now, now, now);
  database
    .prepare(
      `INSERT INTO workspaces(
        id, name, slug, icon, timezone, settings_json, created_at, updated_at
      ) VALUES ('ws_test', 'Test', 'test', 'T', 'UTC', '{}', ?, ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO workspace_members(
        id, workspace_id, user_id, role, status, joined_at
      ) VALUES
        ('wm_author', 'ws_test', 'usr_author', 'member', 'active', ?),
        ('wm_member', 'ws_test', 'usr_member', 'member', 'active', ?),
        ('wm_lead', 'ws_test', 'usr_lead', 'member', 'active', ?),
        ('wm_admin', 'ws_test', 'usr_admin', 'admin', 'active', ?)`,
    )
    .run(now, now, now, now);
  database
    .prepare(
      `INSERT INTO teams(
        id, workspace_id, name, key, description, color, icon, is_private,
        triage_enabled, next_issue_number, cycle_settings_json, created_at, updated_at
      ) VALUES
        ('team_main', 'ws_test', 'Main', 'MAIN', '', '#000', 'M', 0, 1, 4, '{}', ?, ?),
        ('team_private', 'ws_test', 'Private', 'PRIV', '', '#111', 'P', 1, 0, 2, '{}', ?, ?),
        ('team_other', 'ws_test', 'Other', 'OTH', '', '#222', 'O', 0, 0, 1, '{}', ?, ?)`,
    )
    .run(now, now, now, now, now, now);
  database
    .prepare(
      `INSERT INTO team_members(team_id, user_id, role, joined_at) VALUES
        ('team_main', 'usr_author', 'member', ?),
        ('team_main', 'usr_member', 'member', ?),
        ('team_main', 'usr_lead', 'lead', ?)`,
    )
    .run(now, now, now);
  database
    .prepare(
      `INSERT INTO workflow_states(
        id, team_id, name, type, color, position, is_default, created_at
      ) VALUES
        ('state_triage', 'team_main', 'Triage', 'triage', '#777', 0, 0, ?),
        ('state_backlog', 'team_main', 'Backlog', 'backlog', '#888', 100, 1, ?),
        ('state_todo', 'team_main', 'Todo', 'unstarted', '#aaa', 200, 0, ?),
        ('state_completed', 'team_main', 'Done', 'completed', '#5b8', 300, 0, ?),
        ('state_duplicate', 'team_main', 'Duplicate', 'canceled', '#999', 400, 0, ?),
        ('state_private', 'team_private', 'Backlog', 'backlog', '#888', 100, 1, ?),
        ('state_other', 'team_other', 'Todo', 'unstarted', '#777', 100, 1, ?)`,
    )
    .run(now, now, now, now, now, now, now);
  database
    .prepare(
      `INSERT INTO issues(
        id, workspace_id, team_id, identifier, number, title, description, status_id,
        priority, creator_id, sort_order, triage_status, version, created_at, updated_at
      ) VALUES
        ('issue_a', 'ws_test', 'team_main', 'MAIN-1', 1, 'Issue A', '', 'state_backlog', 0, 'usr_author', 100, 'pending', 1, ?, ?),
        ('issue_b', 'ws_test', 'team_main', 'MAIN-2', 2, 'Issue B', '', 'state_backlog', 0, 'usr_author', 200, NULL, 1, ?, ?),
        ('issue_c', 'ws_test', 'team_main', 'MAIN-3', 3, 'Issue C', '', 'state_backlog', 0, 'usr_author', 300, NULL, 1, ?, ?),
        ('issue_private', 'ws_test', 'team_private', 'PRIV-1', 1, 'Private issue', '', 'state_private', 0, 'usr_admin', 100, NULL, 1, ?, ?)`,
    )
    .run(now, now, now, now, now, now, now, now);
  database
    .prepare(
      `INSERT INTO comments(
        id, issue_id, author_id, parent_id, body, created_at, updated_at
      ) VALUES ('comment_a', 'issue_a', 'usr_author', NULL, 'Original', ?, ?)`,
    )
    .run(now, now);
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "micro-linear-issues-"));
  process.env.MICRO_LINEAR_DB_PATH = join(directory, "test.db");
});

beforeEach(() => fixture());

afterAll(() => {
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
  delete process.env.MICRO_LINEAR_DB_PATH;
});

describe("issue creation", () => {
  it("creates template sub-issues atomically with inherited fields and full bookkeeping", () => {
    getDatabase()
      .prepare(
        `INSERT INTO labels(
          id, workspace_id, team_id, group_id, name, color, description, created_at
        ) VALUES ('label_release', 'ws_test', 'team_main', NULL, 'Release', '#55a', '', ?)`,
      )
      .run("2026-07-11T00:00:00.000Z");
    const created = executeIssueAction("issue.create", "ws_test", "usr_author", {
      teamId: "team_main",
      title: "Release checklist",
      description: "Coordinate release",
      statusId: "state_backlog",
      priority: 2,
      assigneeId: "usr_member",
      estimate: 8,
      dueDate: "2026-08-01",
      labelIds: ["label_release"],
      subIssues: [
        { title: "Run regression", description: "Run the full suite" },
        { title: "Publish notes", description: "Prepare the changelog" },
      ],
    }) as MutationResult<Issue>;

    const rows = getDatabase()
      .prepare(
        `SELECT id, identifier, number, title, description, parent_id, status_id,
                priority, assignee_id, estimate, due_date
           FROM issues
          WHERE team_id = 'team_main' AND number >= 4
          ORDER BY number`,
      )
      .all() as Array<{
      id: string;
      identifier: string;
      number: number;
      title: string;
      description: string;
      parent_id: string | null;
      status_id: string;
      priority: number;
      assignee_id: string | null;
      estimate: number | null;
      due_date: string | null;
    }>;

    expect(created.data.id).toBe(rows[0]?.id);
    expect(rows.map((row) => [row.identifier, row.title, row.parent_id])).toEqual([
      ["MAIN-4", "Release checklist", null],
      ["MAIN-5", "Run regression", created.data.id],
      ["MAIN-6", "Publish notes", created.data.id],
    ]);
    expect(rows.every((row) =>
      row.status_id === "state_backlog" &&
      row.priority === 2 &&
      row.assignee_id === "usr_member" &&
      row.estimate === 8 &&
      row.due_date === "2026-08-01"
    )).toBe(true);
    expect(
      (getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count FROM issue_identifier_aliases
            WHERE issue_id IN (?, ?, ?)`,
        )
        .get(...rows.map((row) => row.id)) as { count: number }).count,
    ).toBe(3);
    expect(
      getDatabase()
        .prepare(
          `SELECT issue_id AS issueId, label_id AS labelId
             FROM issue_labels WHERE label_id = 'label_release'`,
        )
        .all(),
    ).toEqual([{ issueId: created.data.id, labelId: "label_release" }]);
    expect(
      (getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count FROM issue_subscribers
            WHERE issue_id IN (?, ?, ?) AND user_id IN ('usr_author', 'usr_member')`,
        )
        .get(...rows.map((row) => row.id)) as { count: number }).count,
    ).toBe(6);
    expect(
      (getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count FROM activities
            WHERE entity_type = 'issue' AND action = 'created'
              AND entity_id IN (?, ?, ?)`,
        )
        .get(...rows.map((row) => row.id)) as { count: number }).count,
    ).toBe(3);
    expect(
      (getDatabase()
        .prepare(
          `SELECT COUNT(*) AS count FROM outbox_events
            WHERE type = 'issue.created' AND aggregate_id IN (?, ?, ?)`,
        )
        .get(...rows.map((row) => row.id)) as { count: number }).count,
    ).toBe(3);
    expect(
      (getDatabase()
        .prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = 'usr_member'")
        .get() as { count: number }).count,
    ).toBe(1);
    expect(
      (getDatabase()
        .prepare("SELECT next_issue_number FROM teams WHERE id = 'team_main'")
        .get() as { next_issue_number: number }).next_issue_number,
    ).toBe(7);
  });

  it("rejects invalid sub-issues before allocating an issue number", () => {
    expect(() =>
      executeIssueAction("issue.create", "ws_test", "usr_author", {
        teamId: "team_main",
        title: "Parent",
        statusId: "state_backlog",
        subIssues: [{ title: "", description: "Invalid" }],
      }),
    ).toThrow(DomainValidationError);
    expect(
      (getDatabase()
        .prepare("SELECT next_issue_number FROM teams WHERE id = 'team_main'")
        .get() as { next_issue_number: number }).next_issue_number,
    ).toBe(4);
  });

  it("rolls back the parent and prior children when a later child insert fails", () => {
    const database = getDatabase();
    database.exec(
      `CREATE TRIGGER fail_template_sub_issue
       BEFORE INSERT ON issues
       WHEN NEW.title = 'Force rollback'
       BEGIN
         SELECT RAISE(ABORT, 'forced child failure');
       END`,
    );
    try {
      expect(() =>
        executeIssueAction("issue.create", "ws_test", "usr_author", {
          teamId: "team_main",
          title: "Parent",
          statusId: "state_backlog",
          assigneeId: "usr_member",
          subIssues: [
            { title: "First child", description: "Would have succeeded" },
            { title: "Force rollback", description: "Fails in SQLite" },
          ],
        }),
      ).toThrow("forced child failure");
    } finally {
      database.exec("DROP TRIGGER fail_template_sub_issue");
    }

    expect(
      (database
        .prepare("SELECT COUNT(*) AS count FROM issues WHERE team_id = 'team_main'")
        .get() as { count: number }).count,
    ).toBe(3);
    expect(
      (database
        .prepare("SELECT next_issue_number FROM teams WHERE id = 'team_main'")
        .get() as { next_issue_number: number }).next_issue_number,
    ).toBe(4);
    for (const table of [
      "issue_identifier_aliases",
      "issue_subscribers",
      "activities",
      "outbox_events",
      "notifications",
    ]) {
      expect(
        (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
          .count,
      ).toBe(0);
    }
  });
});

describe("issue comments", () => {
  it("updates, resolves, reopens, and soft-deletes a comment", () => {
    const updated = executeIssueAction("comment.update", "ws_test", "usr_author", {
      commentId: "comment_a",
      changes: { body: "Edited body" },
    }) as MutationResult<Comment>;
    expect(updated.data.body).toBe("Edited body");

    const resolved = executeIssueAction("comment.resolve", "ws_test", "usr_member", {
      commentId: "comment_a",
    }) as MutationResult<Comment>;
    expect(resolved.data.resolvedAt).not.toBeNull();

    const reopened = executeIssueAction("comment.reopen", "ws_test", "usr_member", {
      commentId: "comment_a",
    }) as MutationResult<Comment>;
    expect(reopened.data.resolvedAt).toBeNull();

    const deleted = executeIssueAction("comment.delete", "ws_test", "usr_author", {
      commentId: "comment_a",
    });
    expect(deleted?.data).toBe(true);
    const row = getDatabase()
      .prepare("SELECT body, edited_at, deleted_at FROM comments WHERE id = 'comment_a'")
      .get() as { body: string; edited_at: string | null; deleted_at: string | null };
    expect(row).toMatchObject({ body: "Edited body" });
    expect(row.edited_at).not.toBeNull();
    expect(row.deleted_at).not.toBeNull();
  });

  it("enforces edit ownership and toggles a reaction for a reader", () => {
    expect(() =>
      executeIssueAction("comment.update", "ws_test", "usr_member", {
        commentId: "comment_a",
        body: "Not mine",
      }),
    ).toThrow(PermissionError);

    const added = executeIssueAction("comment.reaction.toggle", "ws_test", "usr_member", {
      commentId: "comment_a",
      emoji: "👍",
    }) as MutationResult<{ active: boolean; reaction: Reaction | null }>;
    expect(added.data).toMatchObject({ active: true, reaction: { emoji: "👍" } });
    expect(
      (getDatabase().prepare("SELECT COUNT(*) AS count FROM comment_reactions").get() as {
        count: number;
      }).count,
    ).toBe(1);

    const removed = executeIssueAction("comment.reaction.toggle", "ws_test", "usr_member", {
      commentId: "comment_a",
      emoji: "👍",
    }) as MutationResult<{ active: boolean; reaction: Reaction | null }>;
    expect(removed.data).toEqual({ active: false, reaction: null });
  });

  it("allows a team lead to moderate another author's comment", () => {
    const updated = executeIssueAction("comment.update", "ws_test", "usr_lead", {
      commentId: "comment_a",
      body: "Moderated",
    }) as MutationResult<Comment>;
    expect(updated.data.body).toBe("Moderated");
  });

  it("subscribes and notifies a member mentioned by email", () => {
    executeIssueAction("comment.create", "ws_test", "usr_author", {
      issueId: "issue_a",
      body: "Please review this @member@example.com",
    });
    expect(
      getDatabase()
        .prepare("SELECT 1 AS found FROM issue_subscribers WHERE issue_id = 'issue_a' AND user_id = 'usr_member'")
        .get(),
    ).toEqual({ found: 1 });
    expect(
      getDatabase()
        .prepare("SELECT type FROM notifications WHERE user_id = 'usr_member' ORDER BY created_at DESC LIMIT 1")
        .get(),
    ).toEqual({ type: "mention" });
  });

  it("honors disabled Inbox preferences without dropping subscriptions", () => {
    getDatabase()
      .prepare(
        "INSERT INTO notification_preferences(user_id, workspace_id, channel, event_type, enabled) VALUES ('usr_member', 'ws_test', 'inbox', 'mentioned', 0)",
      )
      .run();
    executeIssueAction("comment.create", "ws_test", "usr_author", {
      issueId: "issue_a",
      body: "This should subscribe @member@example.com without notifying",
    });
    expect(
      getDatabase()
        .prepare("SELECT 1 AS found FROM issue_subscribers WHERE issue_id = 'issue_a' AND user_id = 'usr_member'")
        .get(),
    ).toEqual({ found: 1 });
    expect(
      getDatabase()
        .prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = 'usr_member'")
        .get(),
    ).toEqual({ count: 0 });
  });
});

describe("issue archive and trash", () => {
  it("restores an issue to the active workspace from either archive or trash", () => {
    executeIssueAction("issue.archive", "ws_test", "usr_author", { issueId: "issue_a" });
    executeIssueAction("issue.delete", "ws_test", "usr_author", { issueId: "issue_a" });
    const removed = getDatabase()
      .prepare("SELECT archived_at, trashed_at FROM issues WHERE id = 'issue_a'")
      .get() as { archived_at: string | null; trashed_at: string | null };
    expect(removed.archived_at).not.toBeNull();
    expect(removed.trashed_at).not.toBeNull();

    executeIssueAction("issue.restore", "ws_test", "usr_author", { issueId: "issue_a" });
    expect(
      getDatabase().prepare("SELECT archived_at, trashed_at FROM issues WHERE id = 'issue_a'").get(),
    ).toEqual({ archived_at: null, trashed_at: null });
  });
});

describe("issue planning properties", () => {
  it("keeps triage metadata consistent with workflow status changes", () => {
    const database = getDatabase();
    database
      .prepare(
        `UPDATE issues
            SET status_id = 'state_triage', triage_status = 'pending',
                snoozed_until = '2026-07-12T00:00:00.000Z'
          WHERE id = 'issue_a'`,
      )
      .run();

    const accepted = executeIssueAction("issue.update", "ws_test", "usr_author", {
      issueId: "issue_a",
      changes: { statusId: "state_todo" },
    }) as MutationResult<Issue>;
    expect(accepted.data).toMatchObject({
      statusId: "state_todo",
      triageStatus: "accepted",
      snoozedUntil: null,
    });

    executeIssueAction("issue.update", "ws_test", "usr_author", {
      issueId: "issue_a",
      changes: { statusId: "state_triage" },
    });
    const declined = executeIssueAction("issue.update", "ws_test", "usr_author", {
      issueId: "issue_a",
      changes: { statusId: "state_duplicate" },
    }) as MutationResult<Issue>;
    expect(declined.data).toMatchObject({
      statusId: "state_duplicate",
      triageStatus: "declined",
      snoozedUntil: null,
    });
    expect(declined.data.canceledAt).not.toBeNull();
  });

  it("marks issues pending when they enter triage", () => {
    const moved = executeIssueAction("issue.update", "ws_test", "usr_author", {
      issueId: "issue_b",
      changes: { statusId: "state_triage" },
    }) as MutationResult<Issue>;

    expect(moved.data).toMatchObject({
      statusId: "state_triage",
      triageStatus: "pending",
      snoozedUntil: null,
    });
  });

  it("rejects a status from another team without partially updating the issue", () => {
    expect(() =>
      executeIssueAction("issue.update", "ws_test", "usr_author", {
        issueId: "issue_b",
        changes: { statusId: "state_other" },
      }),
    ).toThrow(DomainValidationError);

    expect(
      getDatabase()
        .prepare("SELECT status_id, version FROM issues WHERE id = 'issue_b'")
        .get(),
    ).toEqual({ status_id: "state_backlog", version: 1 });
  });

  it("moves an issue to another accessible team and preserves its old identifier alias", () => {
    const moved = executeIssueAction("issue.update", "ws_test", "usr_author", {
      issueId: "issue_a",
      changes: { teamId: "team_other" },
    }) as MutationResult<{ teamId: string; identifier: string; statusId: string }>;
    expect(moved.data).toMatchObject({
      teamId: "team_other",
      identifier: "OTH-1",
      statusId: "state_other",
    });
    expect(
      getDatabase()
        .prepare(
          "SELECT identifier, is_current AS current FROM issue_identifier_aliases WHERE issue_id = 'issue_a' ORDER BY identifier",
        )
        .all(),
    ).toEqual([
      { identifier: "MAIN-1", current: 0 },
      { identifier: "OTH-1", current: 1 },
    ]);
  });

  it("only links a milestone belonging to the selected project", () => {
    const now = "2026-07-11T00:00:00.000Z";
    getDatabase().exec(`
      INSERT INTO projects(
        id, workspace_id, team_id, name, slug, status, color, icon,
        created_at, updated_at
      ) VALUES
        ('project_a', 'ws_test', 'team_main', 'Project A', 'project-a', 'planned', '#555', 'A', '${now}', '${now}'),
        ('project_b', 'ws_test', 'team_main', 'Project B', 'project-b', 'planned', '#555', 'B', '${now}', '${now}');
      INSERT INTO project_milestones(id, project_id, name, target_date, position, created_at, updated_at)
      VALUES ('milestone_a', 'project_a', 'Alpha', NULL, 100, '${now}', '${now}');
    `);
    const linked = executeIssueAction("issue.update", "ws_test", "usr_author", {
      issueId: "issue_a",
      changes: { projectId: "project_a", milestoneId: "milestone_a" },
    }) as MutationResult<{ projectId: string | null; milestoneId: string | null }>;
    expect(linked.data).toMatchObject({ projectId: "project_a", milestoneId: "milestone_a" });
    expect(() =>
      executeIssueAction("issue.update", "ws_test", "usr_author", {
        issueId: "issue_a",
        changes: { projectId: "project_b", milestoneId: "milestone_a" },
      }),
    ).toThrow(DomainValidationError);
  });
});

describe("issue relations", () => {
  it("canonicalizes related issues and rejects self or reverse duplicates", () => {
    expect(() =>
      executeIssueAction("issueRelation.create", "ws_test", "usr_author", {
        issueId: "issue_a",
        relatedIssueId: "issue_a",
        type: "related",
      }),
    ).toThrow(DomainValidationError);

    const created = executeIssueAction("issueRelation.create", "ws_test", "usr_author", {
      issueId: "issue_b",
      relatedIssueId: "issue_a",
      type: "related",
    }) as MutationResult<IssueRelation>;
    expect(created.data).toMatchObject({
      issueId: "issue_a",
      relatedIssueId: "issue_b",
      type: "related",
    });
    expect(() =>
      executeIssueAction("issueRelation.create", "ws_test", "usr_author", {
        issueId: "issue_a",
        relatedIssueId: "issue_b",
        type: "related",
      }),
    ).toThrow(ConflictError);
  });

  it("rejects a blocks relation that would close a graph cycle", () => {
    executeIssueAction("issueRelation.create", "ws_test", "usr_author", {
      issueId: "issue_a",
      relatedIssueId: "issue_b",
      type: "blocks",
    });
    executeIssueAction("issueRelation.create", "ws_test", "usr_author", {
      issueId: "issue_b",
      relatedIssueId: "issue_c",
      type: "blocks",
    });
    expect(() =>
      executeIssueAction("issueRelation.create", "ws_test", "usr_author", {
        issueId: "issue_c",
        relatedIssueId: "issue_a",
        type: "blocks",
      }),
    ).toThrow(ConflictError);
  });

  it("moves a duplicate to canceled and restores its prior workflow state on deletion", () => {
    const created = executeIssueAction("issueRelation.create", "ws_test", "usr_author", {
      issueId: "issue_a",
      relatedIssueId: "issue_b",
      type: "duplicate",
    }) as MutationResult<IssueRelation>;
    const duplicated = getDatabase()
      .prepare(
        `SELECT status_id, triage_status, canceled_at
           FROM issues WHERE id = 'issue_a'`,
      )
      .get() as {
      status_id: string;
      triage_status: string | null;
      canceled_at: string | null;
    };
    expect(duplicated).toMatchObject({
      status_id: "state_duplicate",
      triage_status: "declined",
    });
    expect(duplicated.canceled_at).not.toBeNull();

    expect(() =>
      executeIssueAction("issueRelation.create", "ws_test", "usr_author", {
        issueId: "issue_c",
        relatedIssueId: "issue_a",
        type: "duplicate",
      }),
    ).toThrow(ConflictError);

    const deleted = executeIssueAction("issueRelation.delete", "ws_test", "usr_author", {
      relationId: created.data.id,
    });
    expect(deleted?.data).toBe(true);
    const restored = getDatabase()
      .prepare(
        `SELECT status_id, triage_status, canceled_at
           FROM issues WHERE id = 'issue_a'`,
      )
      .get() as {
      status_id: string;
      triage_status: string | null;
      canceled_at: string | null;
    };
    expect(restored).toEqual({
      status_id: "state_backlog",
      triage_status: "pending",
      canceled_at: null,
    });
    expect(
      (getDatabase()
        .prepare("SELECT COUNT(*) AS count FROM issue_relations WHERE id = ?")
        .get(created.data.id) as { count: number }).count,
    ).toBe(0);
  });

  it("requires visibility of the related issue", () => {
    expect(() =>
      executeIssueAction("issueRelation.create", "ws_test", "usr_author", {
        issueId: "issue_a",
        relatedIssueId: "issue_private",
        type: "blocks",
      }),
    ).toThrow(PermissionError);
  });
});
