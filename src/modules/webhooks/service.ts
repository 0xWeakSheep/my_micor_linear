import "server-only";

import { z } from "zod";

import { requireWorkspacePermission } from "@/lib/auth";
import { getAll, getOne, transaction } from "@/lib/db";
import type {
  WebhookDeliveryPage,
  WebhookDeliveryReplay,
  WebhookDeliveryStatus,
  WebhookDeliverySummary,
  WebhookReplayBlockReason,
} from "@/lib/domain";
import { createId } from "@/lib/security";
import { unsealWebhookSecret } from "@/lib/webhook-secret";
import {
  ConflictError,
  DomainValidationError,
  type MutationResult,
  recordActivity,
  recordAudit,
  ResourceNotFoundError,
} from "@/modules/shared/mutation";

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 50;
const MAX_CURSOR_LENGTH = 2_048;
const CURSOR_VERSION = 1;

type DeliveryCursor = readonly [createdAt: string, id: string];

interface CursorEnvelope {
  version: typeof CURSOR_VERSION;
  workspaceId: string;
  webhookId: string;
  position: DeliveryCursor;
}

interface DeliveryHistoryRow {
  id: string;
  webhook_id: string;
  event_id: string;
  event_type: string | null;
  resource_type: string | null;
  resource_id: string | null;
  response_status: number | null;
  response_excerpt: string | null;
  attempt: number;
  next_attempt_at: string | null;
  delivered_at: string | null;
  created_at: string;
  replay_of_delivery_id: string | null;
  replay_original_event_id: string | null;
  event_processed_at: string | null;
  event_available: number;
  webhook_active: number;
  signing_ready: number;
  latest_attempt: number;
  has_newer_replay: number;
}

interface ReplayDeliveryRow {
  id: string;
  webhook_id: string;
  event_id: string;
  request_body: string;
  response_status: number | null;
  response_body: string | null;
  attempt: number;
  next_attempt_at: string | null;
  delivered_at: string | null;
  replay_of_delivery_id: string | null;
  replay_original_event_id: string | null;
  event_processed_at: string | null;
  event_sequence: number | null;
  webhook_active: number;
  signing_secret_encrypted: string | null;
}

interface ReplayRootRow {
  id: string;
  webhook_id: string;
  event_id: string;
  request_body: string;
  replay_of_delivery_id: string | null;
  replay_original_event_id: string | null;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload_json: string;
}

type ResolvedReplayRoot = ReplayRootRow & { originalEventId: string };

function invalidPagination(message: string): never {
  throw new DomainValidationError(message);
}

function parseLimit(searchParams: URLSearchParams): number {
  const values = searchParams.getAll("limit");
  if (values.length === 0) return DEFAULT_PAGE_LIMIT;
  if (values.length > 1 || !/^[1-9]\d*$/.test(values[0] ?? "")) {
    return invalidPagination("The limit query parameter must be a whole number.");
  }
  const limit = Number(values[0]);
  if (!Number.isSafeInteger(limit) || limit > MAX_PAGE_LIMIT) {
    return invalidPagination(
      `The limit query parameter must be between 1 and ${MAX_PAGE_LIMIT}.`,
    );
  }
  return limit;
}

function isDeliveryCursor(value: unknown): value is DeliveryCursor {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    value[0].length > 0 &&
    value[0].length <= 40 &&
    Number.isFinite(Date.parse(value[0])) &&
    typeof value[1] === "string" &&
    value[1].length > 0 &&
    value[1].length <= 160
  );
}

function decodeCursor(
  encoded: string,
  workspaceId: string,
  webhookId: string,
): DeliveryCursor {
  if (
    encoded.length === 0 ||
    encoded.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(encoded)
  ) {
    return invalidPagination("The cursor query parameter is invalid.");
  }

  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) {
      return invalidPagination("The cursor query parameter is invalid.");
    }
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      !("version" in value) ||
      value.version !== CURSOR_VERSION ||
      !("workspaceId" in value) ||
      value.workspaceId !== workspaceId ||
      !("webhookId" in value) ||
      value.webhookId !== webhookId ||
      !("position" in value) ||
      !isDeliveryCursor(value.position)
    ) {
      return invalidPagination("The cursor query parameter is invalid for this webhook.");
    }
    return value.position;
  } catch (error) {
    if (error instanceof DomainValidationError) throw error;
    return invalidPagination("The cursor query parameter is invalid.");
  }
}

function readPagination(
  searchParams: URLSearchParams,
  workspaceId: string,
  webhookId: string,
): { cursor: DeliveryCursor | null; limit: number } {
  const cursorValues = searchParams.getAll("cursor");
  if (cursorValues.length > 1) {
    return invalidPagination("The cursor query parameter may only be provided once.");
  }
  return {
    cursor:
      cursorValues[0] === undefined
        ? null
        : decodeCursor(cursorValues[0], workspaceId, webhookId),
    limit: parseLimit(searchParams),
  };
}

function encodeCursor(
  workspaceId: string,
  webhookId: string,
  position: DeliveryCursor,
): string {
  const envelope: CursorEnvelope = {
    version: CURSOR_VERSION,
    workspaceId,
    webhookId,
    position,
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

function deliveryStatus(row: DeliveryHistoryRow): WebhookDeliveryStatus {
  if (row.delivered_at) return "delivered";
  if (row.next_attempt_at) {
    return row.latest_attempt && !row.event_processed_at ? "retrying" : "failed";
  }
  if (row.response_status !== null || row.response_excerpt !== null) return "failed";
  return "queued";
}

function replayBlockReason(
  row: DeliveryHistoryRow,
  status: WebhookDeliveryStatus,
): WebhookReplayBlockReason | null {
  if (status !== "failed") return "delivery_not_failed";
  if (!row.event_available) return "event_unavailable";
  if (!row.event_processed_at) return "event_pending";
  if (!row.latest_attempt || row.has_newer_replay) return "newer_delivery_exists";
  if (!row.webhook_active) return "webhook_inactive";
  if (!row.signing_ready) return "signing_key_unavailable";
  return null;
}

function toDelivery(row: DeliveryHistoryRow): WebhookDeliverySummary {
  const status = deliveryStatus(row);
  const replayBlockedReason = replayBlockReason(row, status);
  return {
    id: row.id,
    webhookId: row.webhook_id,
    eventId: row.event_id,
    eventType: row.event_type ?? "unknown",
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    status,
    attempt: row.attempt,
    responseStatus: row.response_status,
    responseExcerpt:
      status === "failed" || status === "retrying" ? row.response_excerpt : null,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    nextAttemptAt: status === "retrying" ? row.next_attempt_at : null,
    replayOfDeliveryId: row.replay_of_delivery_id,
    canReplay: replayBlockedReason === null,
    replayBlockedReason,
  };
}

export function listWebhookDeliveries(
  actorId: string,
  workspaceSlug: string,
  webhookId: string,
  searchParams: URLSearchParams,
): WebhookDeliveryPage {
  const workspace = getOne<{ id: string }>(
    "SELECT id FROM workspaces WHERE slug = ? COLLATE NOCASE",
    workspaceSlug,
  );
  if (!workspace) throw new ResourceNotFoundError("Workspace not found.");
  requireWorkspacePermission(actorId, workspace.id, "manage_settings");

  const webhook = getOne<{ id: string }>(
    "SELECT id FROM webhooks WHERE id = ? AND workspace_id = ?",
    webhookId,
    workspace.id,
  );
  if (!webhook) throw new ResourceNotFoundError("Webhook not found.");

  const { cursor, limit } = readPagination(
    searchParams,
    workspace.id,
    webhook.id,
  );
  const cursorClause = cursor
    ? "AND (wd.created_at < ? OR (wd.created_at = ? AND wd.id < ?))"
    : "";
  const parameters: Array<string | number> = [webhook.id];
  if (cursor) parameters.push(cursor[0], cursor[0], cursor[1]);
  parameters.push(limit + 1);

  const rows = getAll<DeliveryHistoryRow>(
    `SELECT wd.id, wd.webhook_id, wd.event_id,
            wd.response_status, substr(wd.response_body, 1, 1024) AS response_excerpt,
            wd.attempt, wd.next_attempt_at, wd.delivered_at, wd.created_at,
            oe.type AS event_type, oe.aggregate_type AS resource_type,
            oe.aggregate_id AS resource_id,
            oe.replay_of_delivery_id, oe.replay_original_event_id,
            oe.processed_at AS event_processed_at,
            CASE WHEN oe.id IS NULL THEN 0 ELSE 1 END AS event_available,
            w.is_active AS webhook_active,
            CASE WHEN w.signing_secret_encrypted IS NULL THEN 0 ELSE 1 END AS signing_ready,
            CASE WHEN EXISTS (
              SELECT 1 FROM webhook_deliveries newer_attempt
               WHERE newer_attempt.webhook_id = wd.webhook_id
                 AND newer_attempt.event_id = wd.event_id
                 AND newer_attempt.attempt > wd.attempt
            ) THEN 0 ELSE 1 END AS latest_attempt,
            CASE WHEN oe.id IS NOT NULL AND EXISTS (
              SELECT 1 FROM outbox_events newer_replay
               WHERE newer_replay.target_webhook_id = wd.webhook_id
                 AND (
                   newer_replay.replay_original_event_id =
                     COALESCE(oe.replay_original_event_id, oe.id) OR
                   (
                     newer_replay.replay_original_event_id IS NULL AND
                     newer_replay.replay_of_delivery_id =
                       COALESCE(oe.replay_of_delivery_id, wd.id)
                   )
                 )
                 AND newer_replay.rowid > oe.rowid
            ) THEN 1 ELSE 0 END AS has_newer_replay
       FROM webhook_deliveries wd
       JOIN webhooks w ON w.id = wd.webhook_id
       LEFT JOIN outbox_events oe
         ON oe.id = wd.event_id AND oe.workspace_id = w.workspace_id
      WHERE wd.webhook_id = ?
        ${cursorClause}
      ORDER BY wd.created_at DESC, wd.id DESC
      LIMIT ?`,
    ...parameters,
  );

  const hasNextPage = rows.length > limit;
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(toDelivery),
    nextCursor:
      hasNextPage && last
        ? encodeCursor(workspace.id, webhook.id, [last.created_at, last.id])
        : null,
  };
}

function replayConflict(message: string): never {
  throw new ConflictError(message);
}

function getReplayDelivery(
  workspaceId: string,
  webhookId: string,
  deliveryId: string,
): ReplayDeliveryRow {
  const row = getOne<ReplayDeliveryRow>(
    `SELECT wd.id, wd.webhook_id, wd.event_id, wd.request_body,
            wd.response_status, wd.response_body, wd.attempt,
            wd.next_attempt_at, wd.delivered_at,
            oe.replay_of_delivery_id, oe.replay_original_event_id,
            oe.processed_at AS event_processed_at,
            oe.rowid AS event_sequence, w.is_active AS webhook_active,
            w.signing_secret_encrypted
       FROM webhook_deliveries wd
       JOIN webhooks w ON w.id = wd.webhook_id
       LEFT JOIN outbox_events oe
         ON oe.id = wd.event_id AND oe.workspace_id = w.workspace_id
      WHERE wd.id = ? AND wd.webhook_id = ? AND w.workspace_id = ?`,
    deliveryId,
    webhookId,
    workspaceId,
  );
  if (!row) throw new ResourceNotFoundError("Webhook delivery not found.");
  return row;
}

function validateReplaySource(
  workspaceId: string,
  source: ReplayDeliveryRow,
): ResolvedReplayRoot {
  if (source.delivered_at || source.next_attempt_at) {
    return replayConflict("Only a final failed webhook delivery can be replayed.");
  }
  if (source.response_status === null && source.response_body === null) {
    return replayConflict("Only a final failed webhook delivery can be replayed.");
  }
  if (!source.event_processed_at || source.event_sequence === null) {
    return replayConflict("Wait for the original event to finish before replaying it.");
  }
  if (!source.webhook_active) {
    return replayConflict("Enable this webhook before replaying a delivery.");
  }
  if (!source.signing_secret_encrypted) {
    return replayConflict("Rotate this webhook's signing secret before replaying a delivery.");
  }
  try {
    unsealWebhookSecret(source.signing_secret_encrypted);
  } catch {
    return replayConflict("Rotate this webhook's signing secret before replaying a delivery.");
  }

  const newerAttempt = getOne<{ found: number }>(
    `SELECT 1 AS found FROM webhook_deliveries
      WHERE webhook_id = ? AND event_id = ? AND attempt > ?
      LIMIT 1`,
    source.webhook_id,
    source.event_id,
    source.attempt,
  );
  if (newerAttempt) {
    return replayConflict("Replay the latest failed attempt for this event.");
  }

  const root = resolveReplayRoot(workspaceId, source.webhook_id, source.id);
  const newerReplay = getOne<{ found: number }>(
    `SELECT 1 AS found FROM outbox_events
      WHERE target_webhook_id = ?
        AND (
          replay_original_event_id = ? OR
          (replay_original_event_id IS NULL AND replay_of_delivery_id = ?)
        )
        AND rowid > ?
      LIMIT 1`,
    source.webhook_id,
    root.originalEventId,
    root.id,
    source.event_sequence,
  );
  if (newerReplay) {
    return replayConflict("A newer replay already exists; use its latest failed delivery.");
  }

  return root;
}

function resolveReplayRoot(
  workspaceId: string,
  webhookId: string,
  deliveryId: string,
): ResolvedReplayRoot {
  const visited = new Set<string>();
  let originalEventId: string | null = null;
  let currentDeliveryId = deliveryId;
  for (let depth = 0; depth < 100; depth += 1) {
    if (visited.has(currentDeliveryId)) {
      return replayConflict("The webhook replay chain is invalid.");
    }
    visited.add(currentDeliveryId);
    const row = getOne<ReplayRootRow>(
      `SELECT wd.id, wd.webhook_id, wd.event_id, wd.request_body,
              oe.replay_of_delivery_id, oe.replay_original_event_id,
              oe.type, oe.aggregate_type,
              oe.aggregate_id, oe.payload_json
         FROM webhook_deliveries wd
         JOIN webhooks w ON w.id = wd.webhook_id
         JOIN outbox_events oe
           ON oe.id = wd.event_id AND oe.workspace_id = w.workspace_id
        WHERE wd.id = ? AND wd.webhook_id = ? AND w.workspace_id = ?`,
      currentDeliveryId,
      webhookId,
      workspaceId,
    );
    if (!row) {
      return replayConflict("The original webhook event is no longer available.");
    }
    if (row.replay_original_event_id) {
      if (originalEventId && originalEventId !== row.replay_original_event_id) {
        return replayConflict("The webhook replay chain has conflicting event identities.");
      }
      originalEventId = row.replay_original_event_id;
    }
    if (!row.replay_of_delivery_id) {
      return { ...row, originalEventId: originalEventId ?? row.event_id };
    }
    currentDeliveryId = row.replay_of_delivery_id;
  }
  return replayConflict("The webhook replay chain is too deep.");
}

export function queueWebhookDeliveryReplay(
  workspaceId: string,
  actorId: string,
  webhookId: string,
  deliveryId: string,
): MutationResult<WebhookDeliveryReplay> {
  requireWorkspacePermission(actorId, workspaceId, "manage_settings");
  const now = new Date().toISOString();
  const eventId = createId("outbox");
  const replayDeliveryId = createId("delivery");

  const data = transaction((database) => {
    const source = getReplayDelivery(workspaceId, webhookId, deliveryId);
    const root = validateReplaySource(workspaceId, source);
    const activeReplay = database
      .prepare(
        `SELECT 1 AS found FROM outbox_events
          WHERE target_webhook_id = ?
            AND (
              replay_original_event_id = ? OR
              (replay_original_event_id IS NULL AND replay_of_delivery_id = ?)
            )
            AND processed_at IS NULL
          LIMIT 1`,
      )
      .get(webhookId, root.originalEventId, root.id);
    if (activeReplay) {
      throw new ConflictError("A replay for this delivery is already queued.");
    }

    database
      .prepare(
        `INSERT INTO outbox_events(
          id, workspace_id, type, aggregate_type, aggregate_id, payload_json,
          available_at, attempts, target_webhook_id, replay_of_delivery_id,
          replay_original_event_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      )
      .run(
        eventId,
        workspaceId,
        root.type,
        root.aggregate_type,
        root.aggregate_id,
        root.payload_json,
        now,
        webhookId,
        root.id,
        root.originalEventId,
        now,
      );
    database
      .prepare(
        `INSERT INTO webhook_deliveries(
          id, webhook_id, event_id, request_body, attempt, created_at
        ) VALUES (?, ?, ?, ?, 1, ?)`,
      )
      .run(replayDeliveryId, webhookId, eventId, root.request_body, now);
    const metadata = {
      sourceDeliveryId: source.id,
      rootDeliveryId: root.id,
      replayDeliveryId,
      eventId,
      originalEventId: root.originalEventId,
    };
    recordActivity(database, {
      workspaceId,
      actorId,
      entityType: "webhook",
      entityId: webhookId,
      action: "delivery.replayQueued",
      metadata,
      createdAt: now,
    });
    recordAudit(database, {
      workspaceId,
      actorId,
      action: "webhook.delivery.replayQueued",
      entityType: "webhook",
      entityId: webhookId,
      metadata,
      createdAt: now,
    });
    return {
      deliveryId: replayDeliveryId,
      eventId,
      originalEventId: root.originalEventId,
      rootDeliveryId: root.id,
      queuedAt: now,
    };
  });

  return {
    data,
    eventType: "webhook.delivery.replayQueued",
    resourceId: replayDeliveryId,
  };
}

export function executeWebhookDeliveryAction(
  action: string,
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult<WebhookDeliveryReplay> | null {
  if (action !== "webhook.delivery.replay") return null;
  const parsed = z
    .object({
      webhookId: z.string().trim().min(1).max(160),
      deliveryId: z.string().trim().min(1).max(160),
    })
    .strict()
    .safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid webhook replay request.");
  return queueWebhookDeliveryReplay(
    workspaceId,
    actorId,
    parsed.data.webhookId,
    parsed.data.deliveryId,
  );
}
