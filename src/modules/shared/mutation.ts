import "server-only";

import type { Database } from "@/lib/db";
import { createId } from "@/lib/security";

export { createNotification } from "./notification";

export interface MutationResult<T = unknown> {
  data: T;
  eventType: string;
  resourceId: string;
}

export class DomainValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

export class ResourceNotFoundError extends Error {
  readonly status = 404;

  constructor(message = "Resource not found.") {
    super(message);
    this.name = "ResourceNotFoundError";
  }
}

export class ConflictError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export function recordActivity(
  database: Database,
  input: {
    workspaceId: string;
    actorId: string;
    entityType: string;
    entityId: string;
    action: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
  },
): string {
  const id = createId("act");
  database
    .prepare(
      `INSERT INTO activities(
        id, workspace_id, entity_type, entity_id, actor_id, action, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.workspaceId,
      input.entityType,
      input.entityId,
      input.actorId,
      input.action,
      JSON.stringify(input.metadata ?? {}),
      input.createdAt,
    );
  return id;
}

export function recordAudit(
  database: Database,
  input: {
    workspaceId: string;
    actorId: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    createdAt: string;
  },
): void {
  database
    .prepare(
      `INSERT INTO audit_logs(
        id, workspace_id, actor_id, action, entity_type, entity_id, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      createId("audit"),
      input.workspaceId,
      input.actorId,
      input.action,
      input.entityType,
      input.entityId ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.createdAt,
    );
}

export function enqueueEvent(
  database: Database,
  input: {
    workspaceId: string;
    type: string;
    aggregateType: string;
    aggregateId: string;
    payload?: Record<string, unknown>;
    createdAt: string;
  },
): string {
  const id = createId("outbox");
  database
    .prepare(
      `INSERT INTO outbox_events(
        id, workspace_id, type, aggregate_type, aggregate_id, payload_json,
        available_at, attempts, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      id,
      input.workspaceId,
      input.type,
      input.aggregateType,
      input.aggregateId,
      JSON.stringify(input.payload ?? {}),
      input.createdAt,
      input.createdAt,
    );
  return id;
}

export function finishMutation(
  database: Database,
  input: {
    workspaceId: string;
    actorId: string;
    entityType: string;
    entityId: string;
    eventType: string;
    action?: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
  },
): void {
  recordActivity(database, {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action ?? input.eventType,
    metadata: input.metadata,
    createdAt: input.createdAt,
  });
  enqueueEvent(database, {
    workspaceId: input.workspaceId,
    type: input.eventType,
    aggregateType: input.entityType,
    aggregateId: input.entityId,
    payload: input.metadata,
    createdAt: input.createdAt,
  });
}
