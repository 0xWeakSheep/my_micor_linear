import "server-only";

import { z } from "zod";

import { requireWorkspacePermission } from "@/lib/auth";
import { getDatabase, transaction } from "@/lib/db";
import type { Favorite, SavedView, ViewFilters } from "@/lib/domain";
import { publishWorkspaceEvent } from "@/lib/events";
import { createId } from "@/lib/security";
import { parseJson } from "@/lib/utils";
import { executeIssueAction } from "@/modules/issues/service";
import { executePlanningAction } from "@/modules/planning/service";
import { executeWorkspaceAction } from "@/modules/workspaces/service";
import { executeDataAction } from "@/modules/data-transfer/service";
import { executeWebhookDeliveryAction } from "@/modules/webhooks/service";
import {
  DomainValidationError,
  finishMutation,
  type MutationResult,
  ResourceNotFoundError,
} from "@/modules/shared/mutation";

const viewFiltersSchema = z
  .object({
    teamIds: z.array(z.string()).optional(),
    statusIds: z.array(z.string()).optional(),
    priorities: z.array(z.number().int().min(0).max(4)).optional(),
    assigneeIds: z.array(z.string()).optional(),
    labelIds: z.array(z.string()).optional(),
    projectIds: z.array(z.string()).optional(),
    cycleIds: z.array(z.string()).optional(),
    creatorIds: z.array(z.string()).optional(),
    search: z.string().max(500).optional(),
    includeArchived: z.boolean().optional(),
    operator: z.enum(["and", "or"]).optional(),
  })
  .strict();

interface SavedViewRow {
  id: string;
  workspace_id: string;
  creator_id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  filters_json: string;
  layout: SavedView["layout"];
  is_shared: number;
  created_at: string;
  updated_at: string;
}

function toSavedView(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    creatorId: row.creator_id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    filters: parseJson<ViewFilters>(row.filters_json, {}),
    layout: row.layout,
    isShared: Boolean(row.is_shared),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getView(viewId: string): SavedViewRow {
  const row = getDatabase().prepare("SELECT * FROM saved_views WHERE id = ?").get(viewId) as unknown as SavedViewRow | undefined;
  if (!row) throw new ResourceNotFoundError("View not found.");
  return row;
}

function executeViewAction(
  action: string,
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult | null {
  if (action === "view.create") {
    requireWorkspacePermission(actorId, workspaceId, "create_view");
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().max(500).optional(),
        icon: z.string().min(1).max(16).optional(),
        color: z.string().min(1).max(32).optional(),
        filters: viewFiltersSchema.optional(),
        layout: z.enum(["list", "board"]).optional(),
        isShared: z.boolean().optional(),
      })
      .strict()
      .safeParse(payload);
    if (!parsed.success) throw new DomainValidationError("Invalid view data.");
    const id = createId("view");
    const now = new Date().toISOString();
    const data = transaction((database) => {
      database
        .prepare(
          `INSERT INTO saved_views(
            id, workspace_id, creator_id, name, description, icon, color,
            filters_json, layout, is_shared, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          workspaceId,
          actorId,
          parsed.data.name,
          parsed.data.description ?? "",
          parsed.data.icon ?? "V",
          parsed.data.color ?? "#7c85e7",
          JSON.stringify(parsed.data.filters ?? {}),
          parsed.data.layout ?? "list",
          parsed.data.isShared ? 1 : 0,
          now,
          now,
        );
      finishMutation(database, { workspaceId, actorId, entityType: "view", entityId: id, eventType: "view.created", action: "created", createdAt: now });
      return toSavedView(database.prepare("SELECT * FROM saved_views WHERE id = ?").get(id) as unknown as SavedViewRow);
    });
    return { data, eventType: "view.created", resourceId: id };
  }

  if (action === "view.update") {
    const parsed = z
      .object({
        viewId: z.string().min(1),
        changes: z
          .object({
            name: z.string().trim().min(1).max(120).optional(),
            description: z.string().max(500).optional(),
            filters: viewFiltersSchema.optional(),
            layout: z.enum(["list", "board"]).optional(),
            isShared: z.boolean().optional(),
          })
          .strict(),
      })
      .strict()
      .safeParse(payload);
    if (!parsed.success) throw new DomainValidationError("Invalid view update.");
    const view = getView(parsed.data.viewId);
    if (view.workspace_id !== workspaceId) throw new ResourceNotFoundError();
    const context = requireWorkspacePermission(actorId, workspaceId, "read");
    if (view.creator_id !== actorId && context.role !== "admin") {
      throw new DomainValidationError("Only the view owner or an admin can edit this view.");
    }
    const data = transaction((database) => {
      const now = new Date().toISOString();
      const next = {
        name: parsed.data.changes.name ?? view.name,
        description: parsed.data.changes.description ?? view.description,
        filters: parsed.data.changes.filters ?? parseJson(view.filters_json, {}),
        layout: parsed.data.changes.layout ?? view.layout,
        isShared: parsed.data.changes.isShared ?? Boolean(view.is_shared),
      };
      database
        .prepare(
          `UPDATE saved_views
              SET name = ?, description = ?, filters_json = ?, layout = ?, is_shared = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(next.name, next.description, JSON.stringify(next.filters), next.layout, next.isShared ? 1 : 0, now, view.id);
      finishMutation(database, { workspaceId, actorId, entityType: "view", entityId: view.id, eventType: "view.updated", action: "updated", createdAt: now });
      return toSavedView(database.prepare("SELECT * FROM saved_views WHERE id = ?").get(view.id) as unknown as SavedViewRow);
    });
    return { data, eventType: "view.updated", resourceId: view.id };
  }

  if (action === "view.delete") {
    const parsed = z.object({ viewId: z.string().min(1) }).safeParse(payload);
    if (!parsed.success) throw new DomainValidationError("Invalid view action.");
    const view = getView(parsed.data.viewId);
    if (view.workspace_id !== workspaceId) throw new ResourceNotFoundError();
    const context = requireWorkspacePermission(actorId, workspaceId, "read");
    if (view.creator_id !== actorId && context.role !== "admin") {
      throw new DomainValidationError("Only the view owner or an admin can delete this view.");
    }
    transaction((database) => database.prepare("DELETE FROM saved_views WHERE id = ?").run(view.id));
    return { data: true, eventType: "view.deleted", resourceId: view.id };
  }
  return null;
}

function executeNotificationAction(
  action: string,
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult | null {
  if (!action.startsWith("notification.")) return null;
  requireWorkspacePermission(actorId, workspaceId, "read");
  const now = new Date().toISOString();
  if (action === "notification.markAllRead") {
    getDatabase()
      .prepare(
        `UPDATE notifications SET read_at = ?
          WHERE workspace_id = ? AND user_id = ? AND read_at IS NULL AND archived_at IS NULL`,
      )
      .run(now, workspaceId, actorId);
    return { data: true, eventType: "notification.updated", resourceId: actorId };
  }

  const parsed = z
    .object({ notificationId: z.string().min(1), until: z.string().max(40).optional() })
    .safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid notification action.");
  const row = getDatabase()
    .prepare("SELECT * FROM notifications WHERE id = ? AND workspace_id = ? AND user_id = ?")
    .get(parsed.data.notificationId, workspaceId, actorId) as
    | (Record<string, unknown> & { id: string })
    | undefined;
  if (!row) throw new ResourceNotFoundError("Notification not found.");

  if (action === "notification.markRead") {
    getDatabase().prepare("UPDATE notifications SET read_at = ? WHERE id = ?").run(now, row.id);
  } else if (action === "notification.markUnread") {
    getDatabase().prepare("UPDATE notifications SET read_at = NULL WHERE id = ?").run(row.id);
  } else if (action === "notification.snooze") {
    if (!parsed.data.until) throw new DomainValidationError("Snooze time is required.");
    getDatabase().prepare("UPDATE notifications SET snoozed_until = ? WHERE id = ?").run(parsed.data.until, row.id);
  } else if (action === "notification.archive") {
    getDatabase().prepare("UPDATE notifications SET archived_at = ? WHERE id = ?").run(now, row.id);
  } else {
    return null;
  }
  return { data: true, eventType: "notification.updated", resourceId: row.id };
}

function executeFavoriteAction(
  action: string,
  workspaceId: string,
  actorId: string,
  payload: unknown,
): MutationResult | null {
  if (action !== "favorite.toggle") return null;
  requireWorkspacePermission(actorId, workspaceId, "read");
  const parsed = z
    .object({
      entityType: z.enum(["issue", "project", "cycle", "initiative", "document", "view"]),
      entityId: z.string().min(1),
    })
    .strict()
    .safeParse(payload);
  if (!parsed.success) throw new DomainValidationError("Invalid favorite.");
  const database = getDatabase();
  const existing = database
    .prepare("SELECT id FROM favorites WHERE user_id = ? AND entity_type = ? AND entity_id = ?")
    .get(actorId, parsed.data.entityType, parsed.data.entityId) as { id: string } | undefined;
  if (existing) {
    database.prepare("DELETE FROM favorites WHERE id = ?").run(existing.id);
    return { data: false, eventType: "favorite.removed", resourceId: parsed.data.entityId };
  }
  const id = createId("favorite");
  const position = database
    .prepare("SELECT COALESCE(MAX(position), 0) + 1024 AS value FROM favorites WHERE user_id = ?")
    .get(actorId) as { value: number };
  database
    .prepare(
      `INSERT INTO favorites(id, user_id, workspace_id, entity_type, entity_id, position)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, actorId, workspaceId, parsed.data.entityType, parsed.data.entityId, position.value);
  const favorite: Favorite = {
    id,
    userId: actorId,
    workspaceId,
    entityType: parsed.data.entityType,
    entityId: parsed.data.entityId,
    position: position.value,
  };
  return { data: favorite, eventType: "favorite.added", resourceId: parsed.data.entityId };
}

export function executeAction(
  action: string,
  workspaceId: string,
  actorId: string,
  payload: unknown,
): unknown {
  requireWorkspacePermission(actorId, workspaceId, "read");

  const result =
    executeIssueAction(action, workspaceId, actorId, payload) ??
    executePlanningAction(action, workspaceId, actorId, payload) ??
    executeWorkspaceAction(action, workspaceId, actorId, payload) ??
    executeWebhookDeliveryAction(action, workspaceId, actorId, payload) ??
    executeDataAction(action, workspaceId, actorId, payload) ??
    executeViewAction(action, workspaceId, actorId, payload) ??
    executeNotificationAction(action, workspaceId, actorId, payload) ??
    executeFavoriteAction(action, workspaceId, actorId, payload);

  if (!result) throw new DomainValidationError(`Unsupported action: ${action}`);
  publishWorkspaceEvent({
    workspaceId,
    actorId,
    type: result.eventType,
    resourceId: result.resourceId,
  });
  return result.data;
}
