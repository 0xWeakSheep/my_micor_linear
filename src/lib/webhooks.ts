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

export function isValidWebhookEndpoint(value: string): boolean {
  if (value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}
