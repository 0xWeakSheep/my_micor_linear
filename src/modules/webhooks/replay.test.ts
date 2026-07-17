// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PermissionError } from "@/lib/auth";
import { executeAction } from "@/lib/action-service";
import { closeDatabase, getDatabase } from "@/lib/db";
import type { WebhookDeliveryReplay } from "@/lib/domain";
import { sealWebhookSecret } from "@/lib/webhook-secret";
import {
  ConflictError,
  DomainValidationError,
  ResourceNotFoundError,
} from "@/modules/shared/mutation";
import {
  executeWebhookDeliveryAction,
  queueWebhookDeliveryReplay,
} from "./service";

const CREATED_AT = "2026-07-17T01:00:00.000Z";
let directory = "";

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
         ('wm_admin', 'ws_test', 'usr_admin', 'admin', 'active', ?),
         ('wm_member', 'ws_test', 'usr_member', 'member', 'active', ?)`,
    )
    .run(CREATED_AT, CREATED_AT);
  const insertWebhook = database.prepare(
    `INSERT INTO webhooks(
      id, workspace_id, name, url, secret_hash, signing_secret_encrypted,
      events_json, is_active, created_by_id, created_at, updated_at
    ) VALUES (?, 'ws_test', ?, ?, 'hash', ?, '["*"]', 1, 'usr_admin', ?, ?)`,
  );
  insertWebhook.run(
    "hook_main",
    "Main",
    "https://hooks.example.com/main",
    sealWebhookSecret("main-secret"),
    CREATED_AT,
    CREATED_AT,
  );
  insertWebhook.run(
    "hook_other",
    "Other",
    "https://hooks.example.com/other",
    sealWebhookSecret("other-secret"),
    CREATED_AT,
    CREATED_AT,
  );
}

function insertOutbox(input: {
  id: string;
  createdAt?: string;
  processedAt?: string | null;
  targetWebhookId?: string | null;
  replayOfDeliveryId?: string | null;
  payload?: string;
}): void {
  const createdAt = input.createdAt ?? CREATED_AT;
  getDatabase()
    .prepare(
      `INSERT INTO outbox_events(
        id, workspace_id, type, aggregate_type, aggregate_id, payload_json,
        available_at, attempts, processed_at, target_webhook_id,
        replay_of_delivery_id, created_at
      ) VALUES (?, 'ws_test', 'issue.updated', 'issue', 'issue_42', ?, ?, 1, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.payload ?? '{"changed":["status"]}',
      createdAt,
      input.processedAt === undefined ? createdAt : input.processedAt,
      input.targetWebhookId ?? null,
      input.replayOfDeliveryId ?? null,
      createdAt,
    );
}

function insertDelivery(input: {
  id: string;
  eventId: string;
  body?: string;
  webhookId?: string;
  responseStatus?: number | null;
  responseBody?: string | null;
  attempt?: number;
  nextAttemptAt?: string | null;
  deliveredAt?: string | null;
  createdAt?: string;
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
      input.body ?? '{"id":"event_root","data":{"message":"原始内容"}}',
      input.responseStatus === undefined ? 503 : input.responseStatus,
      input.responseBody === undefined ? "upstream unavailable" : input.responseBody,
      input.attempt ?? 1,
      input.nextAttemptAt ?? null,
      input.deliveredAt ?? null,
      input.createdAt ?? CREATED_AT,
    );
}

function seedFailedRoot(): string {
  const body = '{\n  "id": "event_root",\n  "data": {"message":"café 上海", "spacing":"  "}\n}';
  insertOutbox({ id: "event_root", payload: '{"ignored":"must remain byte stable"}' });
  insertDelivery({
    id: "delivery_root",
    eventId: "event_root",
    body,
    attempt: 3,
  });
  return body;
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "micro-linear-webhook-replay-"));
  vi.stubEnv("MICRO_LINEAR_DB_PATH", join(directory, "replay.db"));
});

beforeEach(() => resetFixture());

afterAll(() => {
  closeDatabase();
  vi.unstubAllEnvs();
  rmSync(directory, { force: true, recursive: true });
});

describe("webhook delivery replay", () => {
  it("is reachable through the authenticated action dispatcher", () => {
    seedFailedRoot();

    const replay = executeAction(
      "webhook.delivery.replay",
      "ws_test",
      "usr_admin",
      { webhookId: "hook_main", deliveryId: "delivery_root" },
    ) as WebhookDeliveryReplay;

    expect(replay).toMatchObject({
      deliveryId: expect.stringMatching(/^delivery_/),
      eventId: expect.stringMatching(/^outbox_/),
      rootDeliveryId: "delivery_root",
    });
  });

  it("queues a targeted event with a fresh retry budget and the exact root body", () => {
    const rootBody = seedFailedRoot();

    const result = queueWebhookDeliveryReplay(
      "ws_test",
      "usr_admin",
      "hook_main",
      "delivery_root",
    );

    expect(result).toMatchObject({
      eventType: "webhook.delivery.replayQueued",
      resourceId: result.data.deliveryId,
      data: { rootDeliveryId: "delivery_root" },
    });
    expect(
      getDatabase()
        .prepare(
          `SELECT workspace_id AS workspaceId, type, aggregate_type AS aggregateType,
                  aggregate_id AS aggregateId, payload_json AS payloadJson,
                  attempts, processed_at AS processedAt,
                  target_webhook_id AS targetWebhookId,
                  replay_of_delivery_id AS replayOfDeliveryId
             FROM outbox_events WHERE id = ?`,
        )
        .get(result.data.eventId),
    ).toEqual({
      workspaceId: "ws_test",
      type: "issue.updated",
      aggregateType: "issue",
      aggregateId: "issue_42",
      payloadJson: '{"ignored":"must remain byte stable"}',
      attempts: 0,
      processedAt: null,
      targetWebhookId: "hook_main",
      replayOfDeliveryId: "delivery_root",
    });
    expect(
      getDatabase()
        .prepare(
          `SELECT webhook_id AS webhookId, event_id AS eventId,
                  request_body AS requestBody, attempt, response_status AS responseStatus
             FROM webhook_deliveries WHERE id = ?`,
        )
        .get(result.data.deliveryId),
    ).toEqual({
      webhookId: "hook_main",
      eventId: result.data.eventId,
      requestBody: rootBody,
      attempt: 1,
      responseStatus: null,
    });
    expect(getDatabase().prepare("SELECT COUNT(*) AS count FROM activities").get()).toEqual({
      count: 1,
    });
    expect(getDatabase().prepare("SELECT COUNT(*) AS count FROM audit_logs").get()).toEqual({
      count: 1,
    });
    expect(getDatabase().prepare("SELECT COUNT(*) AS count FROM outbox_events").get()).toEqual({
      count: 2,
    });
  });

  it("normalizes replay-of-replay requests to the original root delivery", () => {
    const rootBody = seedFailedRoot();
    insertOutbox({
      id: "event_first_replay",
      createdAt: "2026-07-17T01:01:00.000Z",
      targetWebhookId: "hook_main",
      replayOfDeliveryId: "delivery_root",
    });
    insertDelivery({
      id: "delivery_first_replay",
      eventId: "event_first_replay",
      body: rootBody,
      createdAt: "2026-07-17T01:01:00.000Z",
    });

    const result = queueWebhookDeliveryReplay(
      "ws_test",
      "usr_admin",
      "hook_main",
      "delivery_first_replay",
    );

    expect(result.data.rootDeliveryId).toBe("delivery_root");
    expect(
      getDatabase()
        .prepare(
          `SELECT replay_of_delivery_id AS rootDeliveryId
             FROM outbox_events WHERE id = ?`,
        )
        .get(result.data.eventId),
    ).toEqual({ rootDeliveryId: "delivery_root" });
  });

  it("blocks duplicates once a newer replay is queued", () => {
    seedFailedRoot();
    queueWebhookDeliveryReplay("ws_test", "usr_admin", "hook_main", "delivery_root");

    expect(() =>
      queueWebhookDeliveryReplay("ws_test", "usr_admin", "hook_main", "delivery_root"),
    ).toThrow(ConflictError);
    expect(getDatabase().prepare("SELECT COUNT(*) AS count FROM outbox_events").get()).toEqual({
      count: 2,
    });
  });

  it("rejects delivered, retrying, queued, and unfinished source events", () => {
    insertOutbox({ id: "event_delivered" });
    insertDelivery({
      id: "delivery_delivered",
      eventId: "event_delivered",
      responseStatus: 200,
      responseBody: "ok",
      deliveredAt: CREATED_AT,
    });
    insertOutbox({ id: "event_retrying", processedAt: null });
    insertDelivery({
      id: "delivery_retrying",
      eventId: "event_retrying",
      nextAttemptAt: "2026-07-17T02:00:00.000Z",
    });
    insertOutbox({ id: "event_queued", processedAt: null });
    insertDelivery({
      id: "delivery_queued",
      eventId: "event_queued",
      responseStatus: null,
      responseBody: null,
    });
    insertOutbox({ id: "event_unfinished", processedAt: null });
    insertDelivery({ id: "delivery_unfinished", eventId: "event_unfinished" });

    for (const deliveryId of [
      "delivery_delivered",
      "delivery_retrying",
      "delivery_queued",
      "delivery_unfinished",
    ]) {
      expect(() =>
        queueWebhookDeliveryReplay("ws_test", "usr_admin", "hook_main", deliveryId),
      ).toThrow(ConflictError);
    }
    expect(getDatabase().prepare("SELECT COUNT(*) AS count FROM outbox_events").get()).toEqual({
      count: 4,
    });
  });

  it("enforces administration, ownership, and strict action input", () => {
    seedFailedRoot();
    expect(() =>
      queueWebhookDeliveryReplay("ws_test", "usr_member", "hook_main", "delivery_root"),
    ).toThrow(PermissionError);
    expect(() =>
      queueWebhookDeliveryReplay("ws_test", "usr_admin", "hook_other", "delivery_root"),
    ).toThrow(ResourceNotFoundError);
    expect(() =>
      executeWebhookDeliveryAction("webhook.delivery.replay", "ws_test", "usr_admin", {
        webhookId: "hook_main",
        deliveryId: "delivery_root",
        unexpected: true,
      }),
    ).toThrow(DomainValidationError);
    expect(
      executeWebhookDeliveryAction("webhook.delivery.unknown", "ws_test", "usr_admin", {}),
    ).toBeNull();
  });

  it("requires an active webhook with a usable signing secret", () => {
    seedFailedRoot();
    getDatabase()
      .prepare("UPDATE webhooks SET signing_secret_encrypted = 'invalid' WHERE id = 'hook_main'")
      .run();
    expect(() =>
      queueWebhookDeliveryReplay("ws_test", "usr_admin", "hook_main", "delivery_root"),
    ).toThrow(ConflictError);

    getDatabase()
      .prepare("UPDATE webhooks SET signing_secret_encrypted = ?, is_active = 0 WHERE id = 'hook_main'")
      .run(sealWebhookSecret("main-secret"));
    expect(() =>
      queueWebhookDeliveryReplay("ws_test", "usr_admin", "hook_main", "delivery_root"),
    ).toThrow(ConflictError);
  });
});
