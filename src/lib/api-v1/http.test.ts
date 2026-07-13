// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET as getIssues, POST as createIssue } from "@/app/api/v1/issues/route";
import {
  GET as getIssue,
  PATCH as updateIssue,
} from "@/app/api/v1/issues/[issueId]/route";
import { GET as getMembers } from "@/app/api/v1/members/route";
import { GET as getProjects } from "@/app/api/v1/projects/route";
import { GET as getTeams } from "@/app/api/v1/teams/route";
import { apiV1Data, readApiV1Json, withApiV1 } from "@/lib/api-v1";
import { closeDatabase, getDatabase, getOne } from "@/lib/db";
import type { Issue, Membership, Project, Team } from "@/lib/domain";
import { subscribeToWorkspace, type WorkspaceEvent } from "@/lib/events";
import { hashOpaqueToken } from "@/lib/security";

const TEST_TOKEN = "ml_test_workspace_a";
const READ_ONLY_TOKEN = "ml_test_read_only";
const WRITE_ONLY_TOKEN = "ml_test_write_only";
const GUEST_TOKEN = "ml_test_guest";
const EXPIRED_TOKEN = "ml_test_expired";
const CREATED_AT = "2026-07-01T00:00:00.000Z";

let temporaryDirectory = "";

function request(
  path: string,
  token = TEST_TOKEN,
  init: {
    readonly body?: BodyInit;
    readonly headers?: HeadersInit;
    readonly method?: string;
  } = {},
): NextRequest {
  return new NextRequest(`http://micro-linear.test${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
}

function insertFixture(): void {
  const database = getDatabase();
  const insertUser = database.prepare(
    `INSERT INTO users(id, name, email, avatar_url, timezone, locale, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'UTC', 'en', ?, ?)`,
  );
  insertUser.run("usr_actor", "API Actor", "actor@micro-linear.test", CREATED_AT, CREATED_AT);
  insertUser.run("usr_other", "Other Member", "other@micro-linear.test", CREATED_AT, CREATED_AT);
  insertUser.run("usr_guest", "Guest User", "guest@micro-linear.test", CREATED_AT, CREATED_AT);

  const insertWorkspace = database.prepare(
    `INSERT INTO workspaces(id, name, slug, icon, timezone, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'UTC', ?, ?)`,
  );
  insertWorkspace.run("ws_a", "Workspace A", "workspace-a", "A", CREATED_AT, CREATED_AT);
  insertWorkspace.run("ws_b", "Workspace B", "workspace-b", "B", CREATED_AT, CREATED_AT);

  const insertMembership = database.prepare(
    `INSERT INTO workspace_members(id, workspace_id, user_id, role, status, joined_at)
     VALUES (?, ?, ?, ?, 'active', ?)`,
  );
  insertMembership.run("wmem_actor_a", "ws_a", "usr_actor", "member", CREATED_AT);
  insertMembership.run("wmem_other_a", "ws_a", "usr_other", "member", CREATED_AT);
  insertMembership.run("wmem_guest_a", "ws_a", "usr_guest", "guest", CREATED_AT);
  insertMembership.run("wmem_actor_b", "ws_b", "usr_actor", "member", CREATED_AT);

  const insertTeam = database.prepare(
    `INSERT INTO teams(
       id, workspace_id, name, key, description, color, icon, is_private,
       next_issue_number, created_at, updated_at
     ) VALUES (?, ?, ?, ?, '', '#5E6AD2', ?, ?, ?, ?, ?)`,
  );
  insertTeam.run(
    "team_a_public",
    "ws_a",
    "A Public",
    "PUB",
    "P",
    0,
    2,
    CREATED_AT,
    CREATED_AT,
  );
  insertTeam.run(
    "team_a_private",
    "ws_a",
    "A Private",
    "PRI",
    "R",
    1,
    2,
    CREATED_AT,
    CREATED_AT,
  );
  insertTeam.run(
    "team_a_second",
    "ws_a",
    "Z Public",
    "ZED",
    "Z",
    0,
    1,
    CREATED_AT,
    CREATED_AT,
  );
  insertTeam.run(
    "team_b_public",
    "ws_b",
    "B Public",
    "BEE",
    "B",
    0,
    2,
    CREATED_AT,
    CREATED_AT,
  );
  database
    .prepare(
      `INSERT INTO team_members(team_id, user_id, role, joined_at)
       VALUES (?, 'usr_actor', 'member', ?)`,
    )
    .run("team_a_public", CREATED_AT);
  database
    .prepare(
      `INSERT INTO team_members(team_id, user_id, role, joined_at)
       VALUES ('team_a_public', 'usr_guest', 'member', ?)`,
    )
    .run(CREATED_AT);
  database
    .prepare(
      `INSERT INTO team_members(team_id, user_id, role, joined_at)
       VALUES (?, 'usr_actor', 'member', ?)`,
    )
    .run("team_b_public", CREATED_AT);

  const insertState = database.prepare(
    `INSERT INTO workflow_states(
       id, team_id, name, type, color, position, is_default, created_at
     ) VALUES (?, ?, 'Todo', 'unstarted', '#E2B340', 100, 1, ?)`,
  );
  insertState.run("state_a_public", "team_a_public", CREATED_AT);
  insertState.run("state_a_private", "team_a_private", CREATED_AT);
  insertState.run("state_b_public", "team_b_public", CREATED_AT);

  const insertProject = database.prepare(
    `INSERT INTO projects(
       id, workspace_id, team_id, name, slug, status, color, icon,
       sort_order, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'started', '#5E6AD2', 'P', 100, ?, ?)`,
  );
  insertProject.run(
    "project_a_public",
    "ws_a",
    "team_a_public",
    "A Project",
    "a-project",
    CREATED_AT,
    CREATED_AT,
  );
  insertProject.run(
    "project_a_private",
    "ws_a",
    "team_a_private",
    "Private Project",
    "private-project",
    CREATED_AT,
    CREATED_AT,
  );
  insertProject.run(
    "project_a_second",
    "ws_a",
    "team_a_public",
    "Z Project",
    "z-project",
    CREATED_AT,
    CREATED_AT,
  );
  insertProject.run(
    "project_b_public",
    "ws_b",
    "team_b_public",
    "B Project",
    "b-project",
    CREATED_AT,
    CREATED_AT,
  );
  const insertProjectTeam = database.prepare(
    "INSERT INTO project_teams(project_id, team_id) VALUES (?, ?)",
  );
  insertProjectTeam.run("project_a_public", "team_a_public");
  insertProjectTeam.run("project_a_second", "team_a_public");
  insertProjectTeam.run("project_a_private", "team_a_private");
  insertProjectTeam.run("project_b_public", "team_b_public");

  const insertIssue = database.prepare(
     `INSERT INTO issues(
       id, workspace_id, team_id, identifier, number, title, status_id,
       creator_id, sort_order, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'usr_actor', 100, ?, ?)`,
  );
  insertIssue.run(
    "issue_a_public",
    "ws_a",
    "team_a_public",
    "PUB-1",
    1,
    "Visible A issue",
    "state_a_public",
    CREATED_AT,
    CREATED_AT,
  );
  insertIssue.run(
    "issue_a_page_1",
    "ws_a",
    "team_a_public",
    "PUB-10",
    10,
    "Newest visible issue",
    "state_a_public",
    CREATED_AT,
    "2026-07-03T00:00:00.000Z",
  );
  insertIssue.run(
    "issue_a_page_2",
    "ws_a",
    "team_a_public",
    "PUB-11",
    11,
    "Second visible issue",
    "state_a_public",
    CREATED_AT,
    "2026-07-02T00:00:00.000Z",
  );
  insertIssue.run(
    "issue_a_private",
    "ws_a",
    "team_a_private",
    "PRI-1",
    1,
    "Hidden private issue",
    "state_a_private",
    CREATED_AT,
    CREATED_AT,
  );
  insertIssue.run(
    "issue_b_public",
    "ws_b",
    "team_b_public",
    "BEE-1",
    1,
    "Other workspace issue",
    "state_b_public",
    CREATED_AT,
    CREATED_AT,
  );
  database
    .prepare(
      `INSERT INTO issues(
        id, workspace_id, team_id, identifier, number, title, status_id,
        creator_id, sort_order, trashed_at, created_at, updated_at
      ) VALUES (
        'issue_a_trashed', 'ws_a', 'team_a_public', 'PUB-9', 9,
        'Deleted API fixture', 'state_a_public', 'usr_actor', 900, ?, ?, ?
      )`,
    )
    .run(CREATED_AT, CREATED_AT, CREATED_AT);

  const insertApiKey = database.prepare(
    `INSERT INTO api_keys(
       id, workspace_id, user_id, name, prefix, token_hash, scopes_json,
       expires_at, created_at
     ) VALUES (?, 'ws_a', 'usr_actor', ?, 'ml_test', ?, ?, ?, ?)`,
  );
  insertApiKey.run(
    "key_full",
    "Full token",
    hashOpaqueToken(TEST_TOKEN),
    JSON.stringify(["workspace:read", "issues:read", "issues:write", "projects:read"]),
    null,
    CREATED_AT,
  );
  insertApiKey.run(
    "key_read_only",
    "Read-only token",
    hashOpaqueToken(READ_ONLY_TOKEN),
    JSON.stringify(["issues:read"]),
    null,
    CREATED_AT,
  );
  insertApiKey.run(
    "key_write_only",
    "Write-only token",
    hashOpaqueToken(WRITE_ONLY_TOKEN),
    JSON.stringify(["issues:write"]),
    null,
    CREATED_AT,
  );
  insertApiKey.run(
    "key_expired",
    "Expired token",
    hashOpaqueToken(EXPIRED_TOKEN),
    JSON.stringify(["issues:read"]),
    "2020-01-01T00:00:00.000Z",
    CREATED_AT,
  );
  database
    .prepare(
      `INSERT INTO api_keys(
         id, workspace_id, user_id, name, prefix, token_hash, scopes_json,
         expires_at, created_at
       ) VALUES (
         'key_guest', 'ws_a', 'usr_guest', 'Guest token', 'ml_test', ?, ?, NULL, ?
       )`,
    )
    .run(hashOpaqueToken(GUEST_TOKEN), JSON.stringify(["workspace:read"]), CREATED_AT);
}

beforeAll(() => {
  closeDatabase();
  temporaryDirectory = mkdtempSync(join(tmpdir(), "micro-linear-api-v1-"));
  vi.stubEnv("MICRO_LINEAR_DB_PATH", join(temporaryDirectory, "api-v1.db"));
  vi.stubEnv("AUTH_TOKEN_PEPPER", "api-v1-test-pepper");
  insertFixture();
});

afterAll(() => {
  closeDatabase();
  vi.unstubAllEnvs();
  rmSync(temporaryDirectory, { force: true, recursive: true });
});

describe("REST API v1 authentication", () => {
  it("returns a stable JSON error envelope for a missing token", async () => {
    const response = await withApiV1(
      new Request("http://micro-linear.test/api/v1/issues", {
        headers: { "X-Request-Id": "gateway-request-123" },
      }),
      "issues:read",
      () => apiV1Data([]),
    );
    const body = (await response.json()) as {
      error: { code: string; requestId: string };
    };

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("authentication_required");
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
    expect(body.error.requestId).toBe("gateway-request-123");
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("rejects expired tokens and reports a missing scope without running the handler", async () => {
    const expired = await getIssues(request("/api/v1/issues", EXPIRED_TOKEN));
    expect(expired.status).toBe(401);
    expect((await expired.json()) as object).toMatchObject({
      error: { code: "invalid_token" },
    });

    let handled = false;
    const insufficient = await withApiV1(
      request("/api/v1/issues", READ_ONLY_TOKEN),
      "issues:write",
      () => {
        handled = true;
        return apiV1Data({});
      },
    );
    expect(insufficient.status).toBe(403);
    expect(handled).toBe(false);
    expect((await insufficient.json()) as object).toMatchObject({
      error: { code: "insufficient_scope" },
    });
    expect(
      getOne<{ last_used_at: string | null }>(
        "SELECT last_used_at FROM api_keys WHERE id = 'key_read_only'",
      )?.last_used_at,
    ).not.toBeNull();
  });
});

describe("REST API v1 JSON requests", () => {
  it("requires a JSON media type", async () => {
    const response = await createIssue(
      request("/api/v1/issues", TEST_TOKEN, {
        method: "POST",
        body: JSON.stringify({ teamId: "team_a_public", title: "Wrong media type" }),
        headers: { "Content-Type": "text/plain" },
      }),
    );
    expect(response.status).toBe(415);
    expect((await response.json()) as object).toMatchObject({
      error: { code: "unsupported_media_type" },
    });
  });

  it("bounds streamed JSON bodies without relying on Content-Length", async () => {
    await expect(
      readApiV1Json(
        new Request("http://micro-linear.test/api/v1/issues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "too large" }),
        }),
        { maxBytes: 8 },
      ),
    ).rejects.toMatchObject({ status: 413, code: "payload_too_large" });
  });
});

describe("REST API v1 resource isolation", () => {
  it("lists only teams, projects and issues visible inside the token workspace", async () => {
    const [teamResponse, projectResponse, issueResponse] = await Promise.all([
      getTeams(request("/api/v1/teams")),
      getProjects(request("/api/v1/projects")),
      getIssues(request("/api/v1/issues")),
    ]);

    const teams = (await teamResponse.json()) as { data: Team[]; meta: { count: number } };
    const projects = (await projectResponse.json()) as {
      data: Project[];
      meta: { count: number };
    };
    const issues = (await issueResponse.json()) as { data: Issue[]; meta: { count: number } };

    expect(teamResponse.status).toBe(200);
    expect(teams.data.map((team) => team.id)).toEqual([
      "team_a_public",
      "team_a_second",
    ]);
    expect(teams.meta.count).toBe(2);
    expect(projects.data.map((project) => project.id)).toEqual([
      "project_a_public",
      "project_a_second",
    ]);
    expect(issues.data.map((issue) => issue.id)).toEqual([
      "issue_a_page_1",
      "issue_a_page_2",
      "issue_a_public",
    ]);
    expect(issues.data.every((issue) => issue.workspaceId === "ws_a")).toBe(true);
  });

  it("does not expose soft-deleted issues in lists or direct reads", async () => {
    const listResponse = await getIssues(request("/api/v1/issues"));
    const list = (await listResponse.json()) as { data: Issue[] };
    const detailResponse = await getIssue(request("/api/v1/issues/PUB-9"), {
      params: Promise.resolve({ issueId: "PUB-9" }),
    });

    expect(list.data.some((issue) => issue.id === "issue_a_trashed")).toBe(false);
    expect(detailResponse.status).toBe(404);
  });

  it("paginates issues with a stable opaque cursor", async () => {
    const firstResponse = await getIssues(request("/api/v1/issues?limit=2"));
    const first = (await firstResponse.json()) as {
      data: Issue[];
      meta: {
        count: number;
        pageInfo: { endCursor: string | null; hasNextPage: boolean; limit: number };
        workspaceId: string;
      };
    };
    expect(first.data.map((issue) => issue.id)).toEqual([
      "issue_a_page_1",
      "issue_a_page_2",
    ]);
    expect(first.meta).toMatchObject({
      count: 2,
      pageInfo: { hasNextPage: true, limit: 2 },
      workspaceId: "ws_a",
    });
    expect(first.meta.pageInfo.endCursor).toEqual(expect.any(String));

    const secondResponse = await getIssues(
      request(
        `/api/v1/issues?limit=2&cursor=${encodeURIComponent(first.meta.pageInfo.endCursor ?? "")}`,
      ),
    );
    const second = (await secondResponse.json()) as {
      data: Issue[];
      meta: {
        count: number;
        pageInfo: { endCursor: string | null; hasNextPage: boolean; limit: number };
      };
    };
    expect(second.data.map((issue) => issue.id)).toEqual(["issue_a_public"]);
    expect(second.meta).toMatchObject({
      count: 1,
      pageInfo: { hasNextPage: false, limit: 2 },
    });

    const invalid = await getIssues(request("/api/v1/issues?limit=0"));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()) as object).toMatchObject({
      error: { code: "invalid_pagination" },
    });
  });

  it("paginates accessible teams without exposing private teams", async () => {
    const firstResponse = await getTeams(request("/api/v1/teams?limit=1"));
    const first = (await firstResponse.json()) as {
      data: Team[];
      meta: {
        pageInfo: { endCursor: string | null; hasNextPage: boolean; limit: number };
      };
    };
    expect(first.data.map((team) => team.id)).toEqual(["team_a_public"]);
    expect(first.meta.pageInfo).toMatchObject({ hasNextPage: true, limit: 1 });

    const secondResponse = await getTeams(
      request(
        `/api/v1/teams?limit=1&cursor=${encodeURIComponent(first.meta.pageInfo.endCursor ?? "")}`,
      ),
    );
    const second = (await secondResponse.json()) as {
      data: Team[];
      meta: { pageInfo: { hasNextPage: boolean } };
    };
    expect(second.data.map((team) => team.id)).toEqual(["team_a_second"]);
    expect(second.meta.pageInfo.hasNextPage).toBe(false);
  });

  it("paginates visible projects using a deterministic name tie-break", async () => {
    const firstResponse = await getProjects(request("/api/v1/projects?limit=1"));
    const first = (await firstResponse.json()) as {
      data: Project[];
      meta: {
        pageInfo: { endCursor: string | null; hasNextPage: boolean; limit: number };
      };
    };
    expect(first.data.map((project) => project.id)).toEqual(["project_a_public"]);
    expect(first.meta.pageInfo).toMatchObject({ hasNextPage: true, limit: 1 });

    const secondResponse = await getProjects(
      request(
        `/api/v1/projects?limit=1&cursor=${encodeURIComponent(first.meta.pageInfo.endCursor ?? "")}`,
      ),
    );
    const second = (await secondResponse.json()) as {
      data: Project[];
      meta: { pageInfo: { hasNextPage: boolean } };
    };
    expect(second.data.map((project) => project.id)).toEqual(["project_a_second"]);
    expect(second.meta.pageInfo.hasNextPage).toBe(false);
  });

  it("lists workspace members without leaking another workspace membership", async () => {
    const response = await getMembers(request("/api/v1/members"));
    const body = (await response.json()) as { data: Membership[] };

    expect(response.status).toBe(200);
    expect(body.data.map((membership) => membership.id).sort()).toEqual([
      "wmem_actor_a",
      "wmem_guest_a",
      "wmem_other_a",
    ]);
    expect(body.data.every((membership) => membership.workspaceId === "ws_a")).toBe(true);
  });

  it("paginates members and preserves restricted guest visibility", async () => {
    const firstResponse = await getMembers(request("/api/v1/members?limit=2"));
    const first = (await firstResponse.json()) as {
      data: Membership[];
      meta: {
        pageInfo: { endCursor: string | null; hasNextPage: boolean; limit: number };
      };
    };
    expect(first.data.map((membership) => membership.id)).toEqual([
      "wmem_actor_a",
      "wmem_guest_a",
    ]);
    expect(first.meta.pageInfo).toMatchObject({ hasNextPage: true, limit: 2 });

    const secondResponse = await getMembers(
      request(
        `/api/v1/members?limit=2&cursor=${encodeURIComponent(first.meta.pageInfo.endCursor ?? "")}`,
      ),
    );
    const second = (await secondResponse.json()) as {
      data: Membership[];
      meta: { pageInfo: { hasNextPage: boolean } };
    };
    expect(second.data.map((membership) => membership.id)).toEqual(["wmem_other_a"]);
    expect(second.meta.pageInfo.hasNextPage).toBe(false);

    const guestResponse = await getMembers(
      request("/api/v1/members?limit=10", GUEST_TOKEN),
    );
    const guest = (await guestResponse.json()) as { data: Membership[] };
    expect(guest.data.map((membership) => membership.id)).toEqual([
      "wmem_actor_a",
      "wmem_guest_a",
    ]);
  });
});

describe("REST API v1 issue mutations", () => {
  it("creates and updates an issue through the existing issue service", async () => {
    const events: WorkspaceEvent[] = [];
    const unsubscribe = subscribeToWorkspace("ws_a", (event) => events.push(event));
    let created: { data: Issue };
    let createResponse: Response;
    try {
      createResponse = await createIssue(
        request("/api/v1/issues", TEST_TOKEN, {
          method: "POST",
          body: JSON.stringify({ teamId: "team_a_public", title: "Created over REST" }),
          headers: { "Content-Type": "application/json" },
        }),
      );
      created = (await createResponse.json()) as { data: Issue };

      const updateResponse = await updateIssue(
        request(`/api/v1/issues/${created.data.id}`, TEST_TOKEN, {
          method: "PATCH",
          body: JSON.stringify({ title: "Updated over REST", priority: 2 }),
          headers: { "Content-Type": "application/json" },
        }),
        { params: Promise.resolve({ issueId: created.data.id }) },
      );
      const updated = (await updateResponse.json()) as { data: Issue };

      expect(updateResponse.status).toBe(200);
      expect(updated.data).toMatchObject({ title: "Updated over REST", priority: 2 });
    } finally {
      unsubscribe();
    }

    expect(createResponse.status).toBe(201);
    expect(createResponse.headers.get("location")).toBe(`/api/v1/issues/${created.data.id}`);
    expect(created.data).toMatchObject({
      workspaceId: "ws_a",
      teamId: "team_a_public",
      identifier: "PUB-2",
      title: "Created over REST",
    });

    expect(events.map((event) => event.type)).toEqual(["issue.created", "issue.updated"]);
    expect(events.every((event) => event.resourceId === created.data.id)).toBe(true);
    expect(
      getOne<{ count: number }>(
        `SELECT COUNT(*) AS count FROM outbox_events
          WHERE aggregate_id = ? AND type IN ('issue.created', 'issue.updated')`,
        created.data.id,
      )?.count,
    ).toBe(2);

    const readResponse = await getIssue(request(`/api/v1/issues/${created.data.identifier}`), {
      params: Promise.resolve({ issueId: created.data.identifier }),
    });
    expect(readResponse.status).toBe(200);
    expect((await readResponse.json()) as object).toMatchObject({
      data: { id: created.data.id, title: "Updated over REST" },
    });
  });

  it("cannot update an issue from another workspace even when the actor belongs to both", async () => {
    const response = await updateIssue(
      request("/api/v1/issues/issue_b_public", TEST_TOKEN, {
        method: "PATCH",
        body: JSON.stringify({ title: "Cross-workspace update" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ issueId: "issue_b_public" }) },
    );

    expect(response.status).toBe(404);
    expect((await response.json()) as object).toMatchObject({ error: { code: "not_found" } });
    expect(
      getOne<{ title: string }>("SELECT title FROM issues WHERE id = 'issue_b_public'")?.title,
    ).toBe("Other workspace issue");
  });

  it("rejects writes without issues:write and malformed JSON with typed errors", async () => {
    const readOnly = await updateIssue(
      request("/api/v1/issues/issue_a_public", READ_ONLY_TOKEN, {
        method: "PATCH",
        body: JSON.stringify({ title: "No permission" }),
      }),
      { params: Promise.resolve({ issueId: "issue_a_public" }) },
    );
    expect(readOnly.status).toBe(403);
    expect((await readOnly.json()) as object).toMatchObject({
      error: { code: "insufficient_scope" },
    });

    const writeOnly = await updateIssue(
      request("/api/v1/issues/issue_a_public", WRITE_ONLY_TOKEN, {
        method: "PATCH",
        body: JSON.stringify({ title: "No read scope" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ issueId: "issue_a_public" }) },
    );
    expect(writeOnly.status).toBe(403);
    expect((await writeOnly.json()) as object).toMatchObject({
      error: { code: "insufficient_scope" },
    });

    const beforeEmptyUpdate = getOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM outbox_events WHERE aggregate_id = 'issue_a_public'",
    )?.count;
    const emptyUpdate = await updateIssue(
      request("/api/v1/issues/issue_a_public", TEST_TOKEN, {
        method: "PATCH",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ issueId: "issue_a_public" }) },
    );
    expect(emptyUpdate.status).toBe(400);
    expect((await emptyUpdate.json()) as object).toMatchObject({
      error: { code: "validation_error" },
    });
    expect(
      getOne<{ count: number }>(
        "SELECT COUNT(*) AS count FROM outbox_events WHERE aggregate_id = 'issue_a_public'",
      )?.count,
    ).toBe(beforeEmptyUpdate);

    const invalidJson = await createIssue(
      request("/api/v1/issues", TEST_TOKEN, {
        method: "POST",
        body: "{not-json",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(invalidJson.status).toBe(400);
    expect((await invalidJson.json()) as object).toMatchObject({
      error: { code: "invalid_json" },
    });
  });
});
