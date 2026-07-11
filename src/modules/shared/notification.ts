import type { Database } from "@/lib/db";
import { createId } from "@/lib/security";

export function createNotification(
  database: Database,
  input: {
    userId: string;
    workspaceId: string;
    actorId: string;
    type: string;
    title: string;
    body: string;
    entityType: string;
    entityId: string;
    createdAt: string;
  },
): void {
  if (input.userId === input.actorId) return;
  const preferenceType =
    input.type === "assignment"
      ? "assigned"
      : input.type === "mention"
        ? "mentioned"
        : input.type === "project_update"
          ? "projectUpdates"
          : "subscribed";
  const preference = database
    .prepare(
      `SELECT enabled FROM notification_preferences
        WHERE user_id = ? AND workspace_id = ? AND channel = 'inbox' AND event_type = ?`,
    )
    .get(input.userId, input.workspaceId, preferenceType) as { enabled: number } | undefined;
  if (preference && !preference.enabled) return;
  database
    .prepare(
      `INSERT INTO notifications(
        id, user_id, workspace_id, actor_id, type, title, body,
        entity_type, entity_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      createId("notif"),
      input.userId,
      input.workspaceId,
      input.actorId,
      input.type,
      input.title,
      input.body,
      input.entityType,
      input.entityId,
      input.createdAt,
    );
}
