import { describe, expect, it } from "vitest";

import { isValidWebhookEndpoint, WEBHOOK_EVENTS } from "./webhooks";

describe("webhook event catalog", () => {
  it("keeps every supported mutation available to API settings", () => {
    expect(WEBHOOK_EVENTS).toEqual([
      "issue.created",
      "issue.updated",
      "issue.deleted",
      "comment.created",
      "project.created",
      "project.updated",
      "project-update.created",
      "member.updated",
    ]);
  });

  it("accepts only bounded HTTPS endpoints without credentials or fragments", () => {
    expect(isValidWebhookEndpoint("https://hooks.example.com/events?source=linear")).toBe(true);
    expect(isValidWebhookEndpoint("http://hooks.example.com/events")).toBe(false);
    expect(isValidWebhookEndpoint("https://user:secret@hooks.example.com/events")).toBe(false);
    expect(isValidWebhookEndpoint("https://hooks.example.com/events#fragment")).toBe(false);
    expect(isValidWebhookEndpoint(`https://hooks.example.com/${"a".repeat(2_100)}`)).toBe(false);
  });
});
