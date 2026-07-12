import { describe, expect, it } from "vitest";

import { WEBHOOK_EVENTS } from "./webhooks";

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
});
