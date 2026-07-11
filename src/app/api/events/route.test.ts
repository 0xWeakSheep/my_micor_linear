import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { redactWorkspaceEvent } from "./route";

describe("workspace event stream privacy", () => {
  it("only exposes a generic invalidation signal to every workspace reader", () => {
    const redacted = redactWorkspaceEvent({
      id: "evt_1",
      workspaceId: "workspace_1",
      type: "issue.created",
      resourceId: "private_issue_1",
      actorId: "private_team_member",
      revision: 7,
      createdAt: "2026-07-11T00:00:00.000Z",
    });

    expect(redacted).toEqual({
      id: "evt_1",
      workspaceId: "workspace_1",
      type: "workspace.changed",
      revision: 7,
      createdAt: "2026-07-11T00:00:00.000Z",
    });
    expect(redacted).not.toHaveProperty("resourceId");
    expect(redacted).not.toHaveProperty("actorId");
  });
});
