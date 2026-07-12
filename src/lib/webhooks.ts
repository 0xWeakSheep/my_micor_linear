export const WEBHOOK_EVENTS = [
  "issue.created",
  "issue.updated",
  "issue.deleted",
  "comment.created",
  "project.created",
  "project.updated",
  "project-update.created",
  "member.updated",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
