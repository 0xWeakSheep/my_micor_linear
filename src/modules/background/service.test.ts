import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { migrations } from "@/lib/db/schema";
import { sealWebhookSecret } from "@/lib/webhook-secret";
import {
  deliverOutboxWebhooks,
  processCycles,
  processMaintenance,
  processRecurringIssues,
} from "./service";
import { nextRecurringRun } from "./schedule";
import {
  assertSafeWebhookUrl,
  isPublicNetworkAddress,
  WebhookUrlError,
} from "./webhook-security";

const databases: DatabaseSync[] = [];
const CREATED_AT = "2026-01-01T00:00:00.000Z";

function createTestDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:", {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
  });
  for (const migration of migrations) database.exec(migration.sql);
  databases.push(database);
  return database;
}

function seedWorkspace(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO users(
        id, name, email, timezone, locale, created_at, updated_at
      ) VALUES ('user_1', 'Alex', 'alex@example.com', 'Asia/Shanghai', 'zh-CN', ?, ?)`,
    )
    .run(CREATED_AT, CREATED_AT);
  database
    .prepare(
      `INSERT INTO workspaces(
        id, name, slug, icon, timezone, settings_json, created_at, updated_at
      ) VALUES ('workspace_1', 'Micro Linear', 'micro-linear', 'M', 'Asia/Shanghai', '{}', ?, ?)`,
    )
    .run(CREATED_AT, CREATED_AT);
  database
    .prepare(
      `INSERT INTO workspace_members(
        id, workspace_id, user_id, role, status, joined_at
      ) VALUES ('member_1', 'workspace_1', 'user_1', 'admin', 'active', ?)`,
    )
    .run(CREATED_AT);
  database
    .prepare(
      `INSERT INTO teams(
        id, workspace_id, name, key, description, color, icon, is_private,
        triage_enabled, next_issue_number, cycle_settings_json, created_at, updated_at
      ) VALUES (
        'team_1', 'workspace_1', 'Engineering', 'ENG', '', '#5E6AD2', 'E', 0,
        0, 1, '{}', ?, ?
      )`,
    )
    .run(CREATED_AT, CREATED_AT);
  database
    .prepare(
      `INSERT INTO team_members(team_id, user_id, role, joined_at)
       VALUES ('team_1', 'user_1', 'lead', ?)`,
    )
    .run(CREATED_AT);
  database
    .prepare(
      `INSERT INTO workflow_states(
        id, team_id, name, type, color, position, is_default, created_at
      ) VALUES ('state_todo', 'team_1', 'Todo', 'unstarted', '#888888', 1, 1, ?)`,
    )
    .run(CREATED_AT);
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const database of databases.splice(0)) database.close();
});

describe("recurring issue execution", () => {
  it("creates a parent and sub-issues once, then advances across DST", () => {
    const database = createTestDatabase();
    seedWorkspace(database);
    database
      .prepare(
        `INSERT INTO issue_templates(
          id, workspace_id, team_id, name, title_template, description_template,
          defaults_json, sub_issues_json, created_at, updated_at
        ) VALUES (
          'template_daily', 'workspace_1', 'team_1', 'Daily check',
          'Daily {{date}}', 'Scheduled at {{scheduledAt}}',
          '{"priority":2}', '[{"title":"Verify {{teamKey}}","description":"Checklist"}]',
          ?, ?
        )`,
      )
      .run(CREATED_AT, CREATED_AT);
    database
      .prepare(
        `INSERT INTO recurring_issues(
          id, workspace_id, team_id, template_id, cadence, interval,
          next_run_at, timezone, is_active, created_at, updated_at
        ) VALUES (
          'recurring_daily', 'workspace_1', 'team_1', 'template_daily', 'daily', 1,
          '2026-03-07T14:00:00.000Z', 'America/New_York', 1, ?, ?
        )`,
      )
      .run(CREATED_AT, CREATED_AT);

    const first = processRecurringIssues(database, {
      now: new Date("2026-03-07T14:00:00.000Z"),
    });
    expect(first).toMatchObject({ createdRuns: 1, createdIssues: 2, skippedRuns: 0 });
    const issues = database
      .prepare("SELECT identifier, title, parent_id AS parentId FROM issues ORDER BY number")
      .all() as Array<{ identifier: string; title: string; parentId: string | null }>;
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ identifier: "ENG-1", title: "Daily 2026-03-07" });
    expect(issues[1]).toMatchObject({ identifier: "ENG-2", title: "Verify ENG" });
    expect(issues[1]!.parentId).toBeTruthy();
    expect(database.prepare("SELECT COUNT(*) AS count FROM issue_identifier_aliases").get()).toEqual({
      count: 2,
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM issue_subscribers").get()).toEqual({
      count: 2,
    });

    const recurring = database
      .prepare("SELECT next_run_at AS nextRunAt FROM recurring_issues WHERE id = 'recurring_daily'")
      .get() as { nextRunAt: string };
    expect(recurring.nextRunAt).toBe("2026-03-08T13:00:00.000Z");
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM recurring_issue_runs").get(),
    ).toEqual({ count: 1 });

    expect(
      processRecurringIssues(database, {
        now: new Date("2026-03-07T14:00:00.000Z"),
      }).createdIssues,
    ).toBe(0);

    // Simulate a crash/replay that rewound the cursor after the committed run.
    database
      .prepare("UPDATE recurring_issues SET next_run_at = '2026-03-07T14:00:00.000Z'")
      .run();
    const replay = processRecurringIssues(database, {
      now: new Date("2026-03-07T14:00:00.000Z"),
    });
    expect(replay).toMatchObject({ createdRuns: 0, createdIssues: 0, skippedRuns: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM issues").get()).toEqual({ count: 2 });
  });

  it("clamps monthly recurrences to the last calendar day", () => {
    expect(
      nextRecurringRun(
        "2026-01-31T09:00:00.000Z",
        "monthly",
        1,
        "UTC",
      ),
    ).toBe("2026-02-28T09:00:00.000Z");
  });

  it("moves a nonexistent spring-forward wall time to the next valid time", () => {
    expect(
      nextRecurringRun(
        "2026-03-07T07:30:00.000Z",
        "daily",
        1,
        "America/New_York",
      ),
    ).toBe("2026-03-08T07:30:00.000Z");
  });
});

describe("cycle status and reminders", () => {
  it("completes expired cycles and creates each reminder once", () => {
    const database = createTestDatabase();
    seedWorkspace(database);
    const insertCycle = database.prepare(
      `INSERT INTO cycles(
        id, team_id, number, name, start_date, end_date, status, created_at, updated_at
      ) VALUES (?, 'team_1', ?, ?, ?, ?, 'active', ?, ?)`,
    );
    insertCycle.run(
      "cycle_expired",
      1,
      "Cycle 1",
      "2026-07-01",
      "2026-07-10",
      CREATED_AT,
      CREATED_AT,
    );
    database
      .prepare(
        `INSERT INTO issues(
          id, workspace_id, team_id, identifier, number, title, status_id,
          creator_id, cycle_id, created_at, updated_at
        ) VALUES (
          'issue_rollover', 'workspace_1', 'team_1', 'ENG-1', 1,
          'Carry unfinished work', 'state_todo', 'user_1', 'cycle_expired', ?, ?
        )`,
      )
      .run(CREATED_AT, CREATED_AT);
    insertCycle.run(
      "cycle_overlap",
      2,
      "Overlapping completed cycle",
      "2026-07-05",
      "2026-07-10",
      CREATED_AT,
      CREATED_AT,
    );
    database
      .prepare("UPDATE cycles SET status = 'completed' WHERE id = 'cycle_overlap'")
      .run();
    insertCycle.run(
      "cycle_soon",
      3,
      "Cycle 3",
      "2026-07-11",
      "2026-07-12",
      CREATED_AT,
      CREATED_AT,
    );

    const now = new Date("2026-07-11T04:00:00.000Z");
    const first = processCycles(database, { now, reminderDays: 1 });
    expect(first).toMatchObject({
      scanned: 2,
      statusesUpdated: 1,
      rolledOverIssues: 1,
      remindersCreated: 2,
    });
    expect(
      database.prepare("SELECT status FROM cycles WHERE id = 'cycle_expired'").get(),
    ).toEqual({ status: "completed" });
    expect(
      database.prepare("SELECT type FROM notifications ORDER BY type").all(),
    ).toEqual([{ type: "cycle.completed" }, { type: "cycle.ending_soon" }]);
    expect(
      database.prepare("SELECT cycle_id AS cycleId FROM issues WHERE id = 'issue_rollover'").get(),
    ).toEqual({ cycleId: "cycle_soon" });

    const second = processCycles(database, { now, reminderDays: 1 });
    expect(second).toMatchObject({
      statusesUpdated: 0,
      rolledOverIssues: 0,
      remindersCreated: 0,
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM notifications").get()).toEqual({
      count: 2,
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM cycle_reminder_receipts").get(),
    ).toEqual({ count: 2 });
  });
});

describe("background maintenance", () => {
  it("returns expired snoozed triage issues to the pending queue once", () => {
    const database = createTestDatabase();
    seedWorkspace(database);
    database
      .prepare(
        `INSERT INTO issues(
          id, workspace_id, team_id, identifier, number, title, status_id,
          creator_id, triage_status, snoozed_until, created_at, updated_at
        ) VALUES (
          'issue_snoozed', 'workspace_1', 'team_1', 'ENG-1', 1,
          'Wake triage item', 'state_todo', 'user_1', 'snoozed',
          '2026-07-11T00:00:00.000Z', ?, ?
        )`,
      )
      .run(CREATED_AT, CREATED_AT);

    const first = processMaintenance(database, new Date("2026-07-11T00:00:01.000Z"));
    expect(first).toEqual({ triageWoken: 1, errors: [] });
    expect(
      database
        .prepare("SELECT triage_status AS status, snoozed_until AS until FROM issues WHERE id = 'issue_snoozed'")
        .get(),
    ).toEqual({ status: "pending", until: null });
    expect(database.prepare("SELECT action FROM activities WHERE entity_id = 'issue_snoozed'").get()).toEqual({
      action: "triage.woke",
    });
    expect(processMaintenance(database, new Date("2026-07-11T00:00:02.000Z")).triageWoken).toBe(0);
  });
});

describe("webhook URL safety", () => {
  it("blocks local and private destinations while allowing resolved public HTTPS", async () => {
    expect(isPublicNetworkAddress("8.8.8.8")).toBe(true);
    expect(isPublicNetworkAddress("127.0.0.1")).toBe(false);
    expect(isPublicNetworkAddress("::ffff:7f00:1")).toBe(false);

    await expect(assertSafeWebhookUrl("http://example.com/hook")).rejects.toMatchObject({
      permanent: true,
    });
    await expect(assertSafeWebhookUrl("https://localhost/hook")).rejects.toMatchObject({
      permanent: true,
    });
    await expect(
      assertSafeWebhookUrl("https://hooks.example.com/micro-linear", {
        resolveHost: async () => [{ address: "10.0.0.4", family: 4 }],
      }),
    ).rejects.toMatchObject({ permanent: true });
    await expect(
      assertSafeWebhookUrl("https://hooks.example.com/micro-linear", {
        resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
      }),
    ).resolves.toMatchObject({ protocol: "https:", hostname: "hooks.example.com" });
  });

  it("classifies DNS failures as retryable", async () => {
    const error = await assertSafeWebhookUrl("https://hooks.example.com", {
      resolveHost: async () => {
        throw new Error("temporary DNS failure");
      },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WebhookUrlError);
    expect((error as WebhookUrlError).permanent).toBe(false);
  });
});

describe("outbox webhook delivery", () => {
  it("retries transient failures with a stable idempotency key and stops after success", async () => {
    const database = createTestDatabase();
    seedWorkspace(database);
    database
      .prepare(
        `INSERT INTO webhooks(
          id, workspace_id, name, url, secret_hash, signing_secret_encrypted,
          events_json, is_active,
          created_by_id, created_at, updated_at
        ) VALUES (
          'webhook_1', 'workspace_1', 'Build hook', 'https://hooks.example.com/micro-linear',
          'derived-signing-key', ?, '["issue.created"]', 1, 'user_1', ?, ?
        )`,
      )
      .run(sealWebhookSecret("webhook-test-secret"), CREATED_AT, CREATED_AT);
    database
      .prepare(
        `INSERT INTO outbox_events(
          id, workspace_id, type, aggregate_type, aggregate_id, payload_json,
          available_at, attempts, created_at
        ) VALUES (
          'event_1', 'workspace_1', 'issue.created', 'issue', 'issue_1',
          '{"title":"Test"}', '2026-07-11T00:00:00.000Z', 0,
          '2026-07-11T00:00:00.000Z'
        )`,
      )
      .run();

    const idempotencyKeys: string[] = [];
    const signatures: string[] = [];
    const requestBodies: string[] = [];
    let requests = 0;
    const fetchImplementation: typeof fetch = async (_input, init) => {
      requests += 1;
      idempotencyKeys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
      const headers = new Headers(init?.headers);
      signatures.push(headers.get("x-micro-linear-signature") ?? "");
      expect(headers.get("x-orbit-signature")).toBe(headers.get("x-micro-linear-signature"));
      requestBodies.push(String(init?.body ?? ""));
      return requests === 1
        ? new Response("temporary", { status: 503 })
        : new Response("accepted", { status: 202 });
    };
    const resolveHost = async () => [{ address: "93.184.216.34", family: 4 }];

    const first = await deliverOutboxWebhooks(database, {
      now: new Date("2026-07-11T00:00:00.000Z"),
      fetchImplementation,
      resolveHost,
      baseRetryMs: 1_000,
      maxRetryMs: 10_000,
    });
    expect(first).toMatchObject({
      claimedEvents: 1,
      processedEvents: 0,
      delivered: 0,
      retryScheduled: 1,
    });
    expect(requests).toBe(1);
    expect(
      database.prepare("SELECT processed_at AS processedAt FROM outbox_events").get(),
    ).toEqual({ processedAt: null });

    const tooEarly = await deliverOutboxWebhooks(database, {
      now: new Date("2026-07-11T00:00:00.999Z"),
      fetchImplementation,
      resolveHost,
      baseRetryMs: 1_000,
    });
    expect(tooEarly.claimedEvents).toBe(0);
    expect(requests).toBe(1);

    const second = await deliverOutboxWebhooks(database, {
      now: new Date("2026-07-11T00:00:01.000Z"),
      fetchImplementation,
      resolveHost,
      baseRetryMs: 1_000,
    });
    expect(second).toMatchObject({
      claimedEvents: 1,
      processedEvents: 1,
      delivered: 1,
      retryScheduled: 0,
    });
    expect(requests).toBe(2);
    expect(idempotencyKeys).toEqual(["webhook_1:event_1", "webhook_1:event_1"]);
    expect(signatures).toEqual([
      `sha256=${createHmac("sha256", "webhook-test-secret").update(requestBodies[0]!).digest("hex")}`,
      `sha256=${createHmac("sha256", "webhook-test-secret").update(requestBodies[1]!).digest("hex")}`,
    ]);
    expect(requestBodies[0]).toBe(requestBodies[1]);
    expect(
      database
        .prepare(
          `SELECT attempt, response_status AS responseStatus,
                  delivered_at AS deliveredAt
             FROM webhook_deliveries ORDER BY attempt`,
        )
        .all(),
    ).toEqual([
      { attempt: 1, responseStatus: 503, deliveredAt: null },
      {
        attempt: 2,
        responseStatus: 202,
        deliveredAt: "2026-07-11T00:00:01.000Z",
      },
    ]);

    const completed = await deliverOutboxWebhooks(database, {
      now: new Date("2026-07-12T00:00:00.000Z"),
      fetchImplementation,
      resolveHost,
    });
    expect(completed.claimedEvents).toBe(0);
    expect(requests).toBe(2);
  });

  it("records unsafe URLs as terminal without making a request", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const database = createTestDatabase();
    seedWorkspace(database);
    database
      .prepare(
        `INSERT INTO webhooks(
          id, workspace_id, name, url, secret_hash, events_json, is_active,
          created_by_id, created_at, updated_at
        ) VALUES (
          'webhook_private', 'workspace_1', 'Private hook', 'https://127.0.0.1/hook',
          'key', '["issue.created"]', 1, 'user_1', ?, ?
        )`,
      )
      .run(CREATED_AT, CREATED_AT);
    database
      .prepare(
        `INSERT INTO outbox_events(
          id, workspace_id, type, aggregate_type, aggregate_id, payload_json,
          available_at, attempts, created_at
        ) VALUES (
          'event_private', 'workspace_1', 'issue.created', 'issue', 'issue_1', '{}',
          '2026-07-11T00:00:00.000Z', 0, '2026-07-11T00:00:00.000Z'
        )`,
      )
      .run();
    let requested = false;
    const result = await deliverOutboxWebhooks(database, {
      now: new Date("2026-07-11T00:00:00.000Z"),
      allowInsecureLocalhost: true,
      fetchImplementation: async () => {
        requested = true;
        return new Response(null, { status: 204 });
      },
    });
    expect(requested).toBe(false);
    expect(result).toMatchObject({ processedEvents: 1, terminalFailures: 1 });
    expect(
      database.prepare("SELECT response_body AS body FROM webhook_deliveries").get(),
    ).toMatchObject({ body: expect.stringMatching(/^PERMANENT:/) });
  });
});
