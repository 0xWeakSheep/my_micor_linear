// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PermissionError } from "@/lib/auth";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  DomainValidationError,
  ResourceNotFoundError,
} from "@/modules/shared/mutation";
import { listWebhookDeliveries } from "./service";

const BASE_TIME = Date.parse("2026-07-17T00:00:00.000Z");
let directory = "";

function at(seconds: number): string {
  return new Date(BASE_TIME + seconds * 1_000).toISOString();
}

function resetFixture(): void {
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

  database
    .prepare(
      `INSERT INTO users(id, name, email, timezone, locale, created_at, updated_at)
       VALUES
         ('usr_admin', 'Admin', 'admin@example.com', 'UTC', 'en', ?, ?),
         ('usr_member', 'Member', 'member@example.com', 'UTC', 'en', ?, ?)`,
    )
    .run(at(0), at(0), at(0), at(0));
  database
    .prepare(
      `INSERT INTO workspaces(id, name, slug, icon, timezone, created_at, updated_at)
       VALUES
         ('ws_test', 'Test', 'test', 'T', 'UTC', ?, ?),
         ('ws_other', 'Other', 'other', 'O', 'UTC', ?, ?)` ,
    )
    .run(at(0), at(0), at(0), at(0));
  database
    .prepare(
      `INSERT INTO workspace_members(id, workspace_id, user_id, role, status, joined_at)
       VALUES
         ('wm_admin', 'ws_test', 'usr_admin', 'admin', 'active', ?),
         ('wm_member', 'ws_test', 'usr_member', 'member', 'active', ?)`,
    )
    .run(at(0), at(0));
  database
    .prepare(
      `INSERT INTO webhooks(
         id, workspace_id, name, url, secret_hash, signing_secret_encrypted,
         events_json, is_active, created_by_id, created_at, updated_at
       ) VALUES
         ('hook_main', 'ws_test', 'Main', 'https://hooks.example.com/main',
          'hash', 'sealed', '["*"]', 1, 'usr_admin', ?, ?),
         ('hook_other', 'ws_test', 'Other', 'https://hooks.example.com/other',
          'hash', 'sealed', '["*"]', 1, 'usr_admin', ?, ?)`,
    )
    .run(at(0), at(0), at(0), at(0));
}

function insertEvent(input: {
  id: string;
  createdAt: string;
  processedAt?: string | null;
  replayOfDeliveryId?: string | null;
  targetWebhookId?: string | null;
}): void {
  getDatabase()
    .prepare(
      `INSERT INTO outbox_events(
         id, workspace_id, type, aggregate_type, aggregate_id, payload_json,
         available_at, attempts, processed_at, created_at,
         target_webhook_id, replay_of_delivery_id
       ) VALUES (?, 'ws_test', 'issue.updated', 'issue', 'issue_1', '{}', ?, 1, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.createdAt,
      input.processedAt === undefined ? input.createdAt : input.processedAt,
      input.createdAt,
      input.targetWebhookId ?? null,
      input.replayOfDeliveryId ?? null,
    );
}

function insertDelivery(input: {
  id: string;
  eventId: string;
  createdAt: string;
  webhookId?: string;
  attempt?: number;
  responseStatus?: number | null;
  responseBody?: string | null;
  nextAttemptAt?: string | null;
  deliveredAt?: string | null;
}): void {
  getDatabase()
    .prepare(
      `INSERT INTO webhook_deliveries(
         id, webhook_id, event_id, request_body, response_status, response_body,
         attempt, next_attempt_at, delivered_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.webhookId ?? "hook_main",
      input.eventId,
      `private request body for ${input.id}`,
      input.responseStatus ?? null,
      input.responseBody ?? null,
      input.attempt ?? 1,
      input.nextAttemptAt ?? null,
      input.deliveredAt ?? null,
      input.createdAt,
    );
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "micro-linear-webhook-history-"));
  vi.stubEnv("MICRO_LINEAR_DB_PATH", join(directory, "history.db"));
});

beforeEach(() => resetFixture());

afterAll(() => {
  closeDatabase();
  vi.unstubAllEnvs();
  rmSync(directory, { force: true, recursive: true });
});

describe("webhook delivery history", () => {
  it("returns explicit statuses without exposing request or successful response bodies", () => {
    insertEvent({ id: "event_delivered", createdAt: at(1) });
    insertDelivery({
      id: "delivery_delivered",
      eventId: "event_delivered",
      createdAt: at(1),
      responseStatus: 204,
      responseBody: "successful response must stay private",
      deliveredAt: at(2),
    });
    insertEvent({ id: "event_retrying", createdAt: at(3), processedAt: null });
    insertDelivery({
      id: "delivery_retrying",
      eventId: "event_retrying",
      createdAt: at(3),
      responseStatus: 503,
      responseBody: "temporarily unavailable",
      nextAttemptAt: at(30),
    });
    insertEvent({ id: "event_failed", createdAt: at(4) });
    insertDelivery({
      id: "delivery_failed",
      eventId: "event_failed",
      createdAt: at(4),
      responseStatus: 400,
      responseBody: `PERMANENT: ${"x".repeat(2_000)}`,
    });
    insertEvent({ id: "event_queued", createdAt: at(5), processedAt: null });
    insertDelivery({
      id: "delivery_queued",
      eventId: "event_queued",
      createdAt: at(5),
    });

    const page = listWebhookDeliveries(
      "usr_admin",
      "test",
      "hook_main",
      new URLSearchParams(),
    );

    expect(page.items.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "delivery_queued", status: "queued" },
      { id: "delivery_failed", status: "failed" },
      { id: "delivery_retrying", status: "retrying" },
      { id: "delivery_delivered", status: "delivered" },
    ]);
    const failed = page.items.find((item) => item.id === "delivery_failed")!;
    expect(failed).toMatchObject({ canReplay: true, replayBlockedReason: null });
    expect(failed.responseExcerpt).toHaveLength(1_024);
    expect(page.items.find((item) => item.id === "delivery_delivered")?.responseExcerpt).toBeNull();
    expect(JSON.stringify(page)).not.toContain("private request body");
    expect(JSON.stringify(page)).not.toContain("successful response must stay private");
  });

  it("paginates deterministically and binds cursors to a webhook", () => {
    for (let index = 1; index <= 5; index += 1) {
      insertEvent({ id: `event_${index}`, createdAt: at(index) });
      insertDelivery({
        id: `delivery_${index}`,
        eventId: `event_${index}`,
        createdAt: at(index),
        responseStatus: 400,
        responseBody: "failed",
      });
    }
    const first = listWebhookDeliveries(
      "usr_admin",
      "test",
      "hook_main",
      new URLSearchParams("limit=2"),
    );
    expect(first.items.map((item) => item.id)).toEqual(["delivery_5", "delivery_4"]);
    expect(first.nextCursor).toBeTruthy();

    const second = listWebhookDeliveries(
      "usr_admin",
      "test",
      "hook_main",
      new URLSearchParams(`limit=2&cursor=${first.nextCursor}`),
    );
    expect(second.items.map((item) => item.id)).toEqual(["delivery_3", "delivery_2"]);

    expect(() =>
      listWebhookDeliveries(
        "usr_admin",
        "test",
        "hook_other",
        new URLSearchParams(`cursor=${first.nextCursor}`),
      ),
    ).toThrow(DomainValidationError);
  });

  it("uses the id tie-breaker when deliveries share a timestamp", () => {
    for (const suffix of ["a", "b", "c"]) {
      insertEvent({ id: `event_tie_${suffix}`, createdAt: at(1) });
      insertDelivery({
        id: `delivery_tie_${suffix}`,
        eventId: `event_tie_${suffix}`,
        createdAt: at(1),
        responseStatus: 400,
        responseBody: "failed",
      });
    }

    const first = listWebhookDeliveries(
      "usr_admin",
      "test",
      "hook_main",
      new URLSearchParams("limit=2"),
    );
    const second = listWebhookDeliveries(
      "usr_admin",
      "test",
      "hook_main",
      new URLSearchParams(`limit=2&cursor=${first.nextCursor}`),
    );

    expect(first.items.map((item) => item.id)).toEqual([
      "delivery_tie_c",
      "delivery_tie_b",
    ]);
    expect(second.items.map((item) => item.id)).toEqual(["delivery_tie_a"]);
  });

  it("marks superseded retry attempts as failed instead of retrying forever", () => {
    insertEvent({ id: "event_retried", createdAt: at(1) });
    insertDelivery({
      id: "delivery_attempt_1",
      eventId: "event_retried",
      createdAt: at(1),
      responseStatus: 503,
      responseBody: "temporary failure",
      nextAttemptAt: at(30),
    });
    insertDelivery({
      id: "delivery_attempt_2",
      eventId: "event_retried",
      createdAt: at(2),
      attempt: 2,
      responseStatus: 200,
      responseBody: "ok",
      deliveredAt: at(2),
    });

    const items = listWebhookDeliveries(
      "usr_admin",
      "test",
      "hook_main",
      new URLSearchParams(),
    ).items;
    expect(items.find((item) => item.id === "delivery_attempt_2")).toMatchObject({
      status: "delivered",
    });
    expect(items.find((item) => item.id === "delivery_attempt_1")).toMatchObject({
      status: "failed",
      nextAttemptAt: null,
      canReplay: false,
      replayBlockedReason: "newer_delivery_exists",
    });
  });

  it("does not join event metadata from another workspace", () => {
    getDatabase()
      .prepare(
        `INSERT INTO outbox_events(
           id, workspace_id, type, aggregate_type, aggregate_id, payload_json,
           available_at, attempts, processed_at, created_at
         ) VALUES (
           'event_foreign', 'ws_other', 'private.event', 'secret', 'secret_1', '{}',
           ?, 1, ?, ?
         )`,
      )
      .run(at(1), at(1), at(1));
    insertDelivery({
      id: "delivery_corrupt_reference",
      eventId: "event_foreign",
      createdAt: at(1),
      responseStatus: 400,
      responseBody: "failed",
    });

    const delivery = listWebhookDeliveries(
      "usr_admin",
      "test",
      "hook_main",
      new URLSearchParams(),
    ).items[0];
    expect(delivery).toMatchObject({
      eventType: "unknown",
      resourceType: null,
      resourceId: null,
      canReplay: false,
      replayBlockedReason: "event_unavailable",
    });
  });

  it("allows replay only from the newest failed event in a replay chain", () => {
    insertEvent({ id: "event_original", createdAt: at(1) });
    insertDelivery({
      id: "delivery_original",
      eventId: "event_original",
      createdAt: at(1),
      responseStatus: 500,
      responseBody: "failed",
    });
    insertEvent({
      id: "event_replay",
      createdAt: at(2),
      replayOfDeliveryId: "delivery_original",
      targetWebhookId: "hook_main",
    });
    insertDelivery({
      id: "delivery_replay",
      eventId: "event_replay",
      createdAt: at(2),
      responseStatus: 500,
      responseBody: "still failed",
    });

    const items = listWebhookDeliveries(
      "usr_admin",
      "test",
      "hook_main",
      new URLSearchParams(),
    ).items;
    expect(items.find((item) => item.id === "delivery_original")).toMatchObject({
      canReplay: false,
      replayBlockedReason: "newer_delivery_exists",
    });
    expect(items.find((item) => item.id === "delivery_replay")).toMatchObject({
      replayOfDeliveryId: "delivery_original",
      canReplay: true,
      replayBlockedReason: null,
    });
  });

  it("requires workspace administration and hides cross-workspace identifiers", () => {
    expect(() =>
      listWebhookDeliveries(
        "usr_member",
        "test",
        "hook_main",
        new URLSearchParams(),
      ),
    ).toThrow(PermissionError);
    expect(() =>
      listWebhookDeliveries(
        "usr_admin",
        "test",
        "missing_hook",
        new URLSearchParams(),
      ),
    ).toThrow(ResourceNotFoundError);
  });

  it.each(["0", "51", "1.5", "abc"])("rejects an invalid limit of %s", (limit) => {
    expect(() =>
      listWebhookDeliveries(
        "usr_admin",
        "test",
        "hook_main",
        new URLSearchParams(`limit=${limit}`),
      ),
    ).toThrow(DomainValidationError);
  });
});
