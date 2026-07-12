// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PermissionError } from "@/lib/auth";
import { getBootstrapData } from "@/lib/bootstrap";
import { closeDatabase, getDatabase } from "@/lib/db";
import type { Cycle, Project, ProjectDependency, ProjectMilestone } from "@/lib/domain";
import {
  ConflictError,
  DomainValidationError,
  type MutationResult,
  ResourceNotFoundError,
} from "@/modules/shared/mutation";
import { executePlanningAction, listArchivedProjects } from "./service";

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
        ('usr_actor', 'Actor', 'actor@example.com', NULL, 'UTC', 'en', NULL, ?, ?, '{}'),
        ('usr_lead', 'Lead', 'lead@example.com', NULL, 'UTC', 'en', NULL, ?, ?, '{}'),
        ('usr_guest', 'Guest', 'guest@example.com', NULL, 'UTC', 'en', NULL, ?, ?, '{}'),
        ('usr_outsider', 'Outsider', 'outsider@example.com', NULL, 'UTC', 'en', NULL, ?, ?, '{}')`,
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
        ('wm_actor', 'ws_test', 'usr_actor', 'member', 'active', ?),
        ('wm_lead', 'ws_test', 'usr_lead', 'member', 'active', ?),
        ('wm_guest', 'ws_test', 'usr_guest', 'guest', 'active', ?)`,
    )
    .run(now, now, now);
  database
    .prepare(
      `INSERT INTO teams(
        id, workspace_id, name, key, description, color, icon, is_private,
        triage_enabled, next_issue_number, cycle_settings_json, created_at, updated_at
      ) VALUES
        ('team_main', 'ws_test', 'Main', 'MAIN', '', '#111', 'M', 0, 0, 1, '{}', ?, ?),
        ('team_other', 'ws_test', 'Other', 'OTHER', '', '#222', 'O', 0, 0, 1, '{}', ?, ?)`,
    )
    .run(now, now, now, now);
  database
    .prepare(
      `INSERT INTO team_members(team_id, user_id, role, joined_at) VALUES
        ('team_main', 'usr_actor', 'lead', ?),
        ('team_other', 'usr_actor', 'lead', ?)`,
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO projects(
        id, workspace_id, team_id, name, slug, summary, description, status,
        priority, lead_id, color, icon, start_date, target_date, sort_order,
        archived_at, trashed_at, created_at, updated_at
      ) VALUES (
        'project_main', 'ws_test', 'team_main', 'Original', 'original', '', '', 'planned',
        0, 'usr_actor', '#5e6ad2', 'P', NULL, NULL, 100,
        NULL, NULL, ?, ?
      )`,
    )
    .run(now, now);
  database
    .prepare("INSERT INTO project_teams(project_id, team_id) VALUES ('project_main', 'team_main')")
    .run();
  database
    .prepare("INSERT INTO project_members(project_id, user_id) VALUES ('project_main', 'usr_actor')")
    .run();
}

function insertProject(projectId: string, name: string): void {
  const now = "2026-07-11T00:00:00.000Z";
  const database = getDatabase();
  database
    .prepare(
      `INSERT INTO projects(
        id, workspace_id, team_id, name, slug, summary, description, status,
        priority, lead_id, color, icon, start_date, target_date, sort_order,
        archived_at, trashed_at, created_at, updated_at
      ) VALUES (
        ?, 'ws_test', 'team_main', ?, ?, '', '', 'planned',
        0, 'usr_actor', '#5e6ad2', 'P', NULL, NULL, 100,
        NULL, NULL, ?, ?
      )`,
    )
    .run(projectId, name, projectId, now, now);
  database
    .prepare("INSERT INTO project_teams(project_id, team_id) VALUES (?, 'team_main')")
    .run(projectId);
  database
    .prepare("INSERT INTO project_members(project_id, user_id) VALUES (?, 'usr_actor')")
    .run(projectId);
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "micro-linear-planning-"));
  process.env.MICRO_LINEAR_DB_PATH = join(directory, "test.db");
});

beforeEach(() => fixture());

afterAll(() => {
  closeDatabase();
  rmSync(directory, { recursive: true, force: true });
  delete process.env.MICRO_LINEAR_DB_PATH;
});

describe("project maintenance", () => {
  it("updates content, lead, priority, dates, and multiple teams", () => {
    const updated = executePlanningAction("project.update", "ws_test", "usr_actor", {
      projectId: "project_main",
      changes: {
        name: "Updated project",
        summary: "Short outcome",
        description: "Detailed scope",
        leadId: "usr_lead",
        priority: 2,
        startDate: "2026-08-01",
        targetDate: "2026-09-15",
        teamIds: ["team_main", "team_other"],
      },
    }) as MutationResult<Project>;

    expect(updated.data).toMatchObject({
      name: "Updated project",
      summary: "Short outcome",
      description: "Detailed scope",
      leadId: "usr_lead",
      priority: 2,
      startDate: "2026-08-01",
      targetDate: "2026-09-15",
      teamIds: ["team_main", "team_other"],
    });
    expect(
      getDatabase()
        .prepare("SELECT team_id AS teamId FROM project_teams WHERE project_id = 'project_main' ORDER BY team_id")
        .all(),
    ).toEqual([{ teamId: "team_main" }, { teamId: "team_other" }]);
  });

  it("rejects invalid date ranges and leads outside the workspace", () => {
    expect(() =>
      executePlanningAction("project.update", "ws_test", "usr_actor", {
        projectId: "project_main",
        changes: { startDate: "2026-09-01", targetDate: "2026-08-01" },
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      executePlanningAction("project.update", "ws_test", "usr_actor", {
        projectId: "project_main",
        changes: { leadId: "usr_outsider" },
      }),
    ).toThrow(DomainValidationError);
  });

  it("archives, hides, lists, and restores a project without deleting related data", () => {
    const archived = executePlanningAction("project.archive", "ws_test", "usr_actor", {
      projectId: "project_main",
    }) as MutationResult<Project>;
    expect(archived.eventType).toBe("project.archived");
    expect(archived.data.archivedAt).not.toBeNull();
    expect(getBootstrapData("usr_actor", "test").projects).toEqual([]);
    expect(listArchivedProjects("ws_test", "usr_actor").map((project) => project.id)).toEqual([
      "project_main",
    ]);
    expect(() =>
      executePlanningAction("project.update", "ws_test", "usr_actor", {
        projectId: "project_main",
        changes: { name: "Cannot edit archived" },
      }),
    ).toThrow(ResourceNotFoundError);
    expect(() =>
      executePlanningAction("project.archive", "ws_test", "usr_actor", {
        projectId: "project_main",
      }),
    ).toThrow(DomainValidationError);

    const restored = executePlanningAction("project.restore", "ws_test", "usr_actor", {
      projectId: "project_main",
    }) as MutationResult<Project>;
    expect(restored.eventType).toBe("project.restored");
    expect(restored.data.archivedAt).toBeNull();
    expect(getBootstrapData("usr_actor", "test").projects.map((project) => project.id)).toEqual([
      "project_main",
    ]);
    expect(
      getDatabase()
        .prepare(
          `SELECT action FROM activities
            WHERE entity_type = 'project' AND entity_id = 'project_main'
            ORDER BY created_at, id`,
        )
        .all(),
    ).toEqual(expect.arrayContaining([{ action: "archived" }, { action: "restored" }]));
    expect(
      getDatabase()
        .prepare(
          `SELECT type FROM outbox_events
            WHERE aggregate_type = 'project' AND aggregate_id = 'project_main'`,
        )
        .all(),
    ).toEqual(expect.arrayContaining([{ type: "project.archived" }, { type: "project.restored" }]));
  });

  it("does not allow guests to archive projects", () => {
    expect(() =>
      executePlanningAction("project.archive", "ws_test", "usr_guest", {
        projectId: "project_main",
      }),
    ).toThrow(PermissionError);
  });
});

describe("cycle scheduling", () => {
  it("requires strict calendar dates and a start date before the end date on create and update", () => {
    const invalidCreate = (startDate: string, endDate: string) =>
      executePlanningAction("cycle.create", "ws_test", "usr_actor", {
        teamId: "team_main",
        number: 1,
        name: "Cycle 1",
        startDate,
        endDate,
      });

    expect(() => invalidCreate("2026-7-01", "2026-07-14")).toThrow(
      DomainValidationError,
    );
    expect(() => invalidCreate("2026-02-30", "2026-03-14")).toThrow(
      DomainValidationError,
    );
    expect(() => invalidCreate("2026-07-01", "2026-07-01")).toThrow(
      DomainValidationError,
    );

    const created = executePlanningAction("cycle.create", "ws_test", "usr_actor", {
      teamId: "team_main",
      number: 1,
      name: "Cycle 1",
      startDate: "2026-07-01",
      endDate: "2026-07-14",
    }) as MutationResult<Cycle>;

    expect(() =>
      executePlanningAction("cycle.update", "ws_test", "usr_actor", {
        cycleId: created.data.id,
        changes: { startDate: "2026/07/01" },
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      executePlanningAction("cycle.update", "ws_test", "usr_actor", {
        cycleId: created.data.id,
        changes: { endDate: "2026-07-01" },
      }),
    ).toThrow(DomainValidationError);
  });

  it("rejects overlapping ranges and more than one active cycle on create and update", () => {
    executePlanningAction("cycle.create", "ws_test", "usr_actor", {
      teamId: "team_main",
      number: 1,
      name: "Cycle 1",
      startDate: "2026-07-01",
      endDate: "2026-07-14",
    });

    expect(() =>
      executePlanningAction("cycle.create", "ws_test", "usr_actor", {
        teamId: "team_main",
        number: 1,
        name: "Duplicate number",
        startDate: "2026-08-15",
        endDate: "2026-08-28",
      }),
    ).toThrow(ConflictError);

    expect(() =>
      executePlanningAction("cycle.create", "ws_test", "usr_actor", {
        teamId: "team_main",
        number: 2,
        name: "Overlapping",
        startDate: "2026-07-14",
        endDate: "2026-07-27",
      }),
    ).toThrow(ConflictError);

    executePlanningAction("cycle.create", "ws_test", "usr_actor", {
      teamId: "team_main",
      number: 2,
      name: "Cycle 2",
      startDate: "2026-07-15",
      endDate: "2026-07-28",
      status: "active",
    });

    expect(() =>
      executePlanningAction("cycle.create", "ws_test", "usr_actor", {
        teamId: "team_main",
        number: 3,
        name: "Second active",
        startDate: "2026-07-29",
        endDate: "2026-08-11",
        status: "active",
      }),
    ).toThrow(ConflictError);

    const upcoming = executePlanningAction("cycle.create", "ws_test", "usr_actor", {
      teamId: "team_main",
      number: 3,
      name: "Cycle 3",
      startDate: "2026-07-29",
      endDate: "2026-08-11",
    }) as MutationResult<Cycle>;

    expect(() =>
      executePlanningAction("cycle.update", "ws_test", "usr_actor", {
        cycleId: upcoming.data.id,
        changes: { startDate: "2026-07-28" },
      }),
    ).toThrow(ConflictError);
    expect(() =>
      executePlanningAction("cycle.update", "ws_test", "usr_actor", {
        cycleId: upcoming.data.id,
        changes: { status: "active" },
      }),
    ).toThrow(ConflictError);
  });
});

describe("milestone maintenance", () => {
  it("updates and deletes milestones while rejecting changes after project archival", () => {
    const editable = executePlanningAction("milestone.create", "ws_test", "usr_actor", {
      projectId: "project_main",
      name: "Editable",
      description: "Initial",
      targetDate: "2026-08-01",
    }) as MutationResult<ProjectMilestone>;
    const removable = executePlanningAction("milestone.create", "ws_test", "usr_actor", {
      projectId: "project_main",
      name: "Removable",
    }) as MutationResult<ProjectMilestone>;
    const retained = executePlanningAction("milestone.create", "ws_test", "usr_actor", {
      projectId: "project_main",
      name: "Retained",
    }) as MutationResult<ProjectMilestone>;

    const updated = executePlanningAction("milestone.update", "ws_test", "usr_actor", {
      milestoneId: editable.data.id,
      changes: {
        name: "Edited",
        description: "Updated details",
        targetDate: "2026-08-15",
      },
    }) as MutationResult<ProjectMilestone>;
    expect(updated.data).toMatchObject({
      id: editable.data.id,
      name: "Edited",
      description: "Updated details",
      targetDate: "2026-08-15",
    });

    const deleted = executePlanningAction("milestone.delete", "ws_test", "usr_actor", {
      milestoneId: removable.data.id,
    }) as MutationResult<boolean>;
    expect(deleted.data).toBe(true);
    expect(
      getDatabase()
        .prepare("SELECT id FROM project_milestones WHERE id = ?")
        .get(removable.data.id),
    ).toBeUndefined();

    executePlanningAction("project.archive", "ws_test", "usr_actor", {
      projectId: "project_main",
    });
    expect(() =>
      executePlanningAction("milestone.update", "ws_test", "usr_actor", {
        milestoneId: editable.data.id,
        changes: { name: "Blocked edit" },
      }),
    ).toThrow(ResourceNotFoundError);
    expect(() =>
      executePlanningAction("milestone.delete", "ws_test", "usr_actor", {
        milestoneId: retained.data.id,
      }),
    ).toThrow(ResourceNotFoundError);
    expect(
      getDatabase()
        .prepare("SELECT id FROM project_milestones WHERE id = ?")
        .get(retained.data.id),
    ).toBeDefined();
  });
});

describe("project dependencies", () => {
  it("creates and deletes a DAG edge while rejecting invalid and archived-project changes", () => {
    insertProject("project_b", "Project B");
    insertProject("project_c", "Project C");

    expect(() =>
      executePlanningAction("projectDependency.create", "ws_test", "usr_actor", {
        projectId: "project_main",
        dependsOnProjectId: "project_main",
      }),
    ).toThrow(DomainValidationError);

    const mainToB = executePlanningAction(
      "projectDependency.create",
      "ws_test",
      "usr_actor",
      { projectId: "project_main", dependsOnProjectId: "project_b" },
    ) as MutationResult<ProjectDependency>;
    expect(mainToB.data).toMatchObject({
      projectId: "project_main",
      dependsOnProjectId: "project_b",
    });
    expect(() =>
      executePlanningAction("projectDependency.create", "ws_test", "usr_actor", {
        projectId: "project_main",
        dependsOnProjectId: "project_b",
      }),
    ).toThrow(ConflictError);

    const bToC = executePlanningAction(
      "projectDependency.create",
      "ws_test",
      "usr_actor",
      { projectId: "project_b", dependsOnProjectId: "project_c" },
    ) as MutationResult<ProjectDependency>;
    expect(() =>
      executePlanningAction("projectDependency.create", "ws_test", "usr_actor", {
        projectId: "project_c",
        dependsOnProjectId: "project_main",
      }),
    ).toThrow(ConflictError);

    const deleted = executePlanningAction(
      "projectDependency.delete",
      "ws_test",
      "usr_actor",
      { dependencyId: mainToB.data.id },
    ) as MutationResult<boolean>;
    expect(deleted.data).toBe(true);
    expect(
      getDatabase()
        .prepare("SELECT id FROM project_dependencies WHERE id = ?")
        .get(mainToB.data.id),
    ).toBeUndefined();

    const mainToC = executePlanningAction(
      "projectDependency.create",
      "ws_test",
      "usr_actor",
      { projectId: "project_main", dependsOnProjectId: "project_c" },
    ) as MutationResult<ProjectDependency>;
    executePlanningAction("project.archive", "ws_test", "usr_actor", {
      projectId: "project_main",
    });
    expect(() =>
      executePlanningAction("projectDependency.create", "ws_test", "usr_actor", {
        projectId: "project_main",
        dependsOnProjectId: "project_b",
      }),
    ).toThrow(ResourceNotFoundError);
    expect(() =>
      executePlanningAction("projectDependency.delete", "ws_test", "usr_actor", {
        dependencyId: mainToC.data.id,
      }),
    ).toThrow(ResourceNotFoundError);

    executePlanningAction("project.restore", "ws_test", "usr_actor", {
      projectId: "project_main",
    });
    executePlanningAction("project.archive", "ws_test", "usr_actor", {
      projectId: "project_c",
    });
    expect(() =>
      executePlanningAction("projectDependency.create", "ws_test", "usr_actor", {
        projectId: "project_main",
        dependsOnProjectId: "project_c",
      }),
    ).toThrow(ResourceNotFoundError);
    expect(() =>
      executePlanningAction("projectDependency.delete", "ws_test", "usr_actor", {
        dependencyId: bToC.data.id,
      }),
    ).toThrow(ResourceNotFoundError);
  });
});
