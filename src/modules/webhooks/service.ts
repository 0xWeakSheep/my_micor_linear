import "server-only";

import { requireWorkspacePermission } from "@/lib/auth";
import { getAll, getOne } from "@/lib/db";
import type {
  WebhookDeliveryPage,
  WebhookDeliveryStatus,
  WebhookDeliverySummary,
  WebhookReplayBlockReason,
} from "@/lib/domain";
import {
  DomainValidationError,
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
  event_processed_at: string | null;
  event_available: number;
  webhook_active: number;
  signing_ready: number;
  latest_attempt: number;
  has_newer_replay: number;
}

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
  if (row.next_attempt_at) return "retrying";
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
    nextAttemptAt: row.next_attempt_at,
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
            oe.replay_of_delivery_id, oe.processed_at AS event_processed_at,
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
                 AND newer_replay.replay_of_delivery_id =
                   COALESCE(oe.replay_of_delivery_id, wd.id)
                 AND (
                   newer_replay.created_at > oe.created_at OR
                   (newer_replay.created_at = oe.created_at AND newer_replay.rowid > oe.rowid)
                 )
            ) THEN 1 ELSE 0 END AS has_newer_replay
       FROM webhook_deliveries wd
       JOIN webhooks w ON w.id = wd.webhook_id
       LEFT JOIN outbox_events oe ON oe.id = wd.event_id
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
