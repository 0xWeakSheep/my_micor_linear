import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BootstrapData, Cycle } from "@/lib/domain";

const workspace = vi.hoisted(() => ({ useWorkspace: vi.fn() }));

vi.mock("@/components/workspace/workspace-provider", () => ({
  useWorkspace: workspace.useWorkspace,
}));

import { CyclesHub } from "./cycles-hub";

const currentCycle: Cycle = {
  id: "cycle_1",
  teamId: "team_1",
  number: 1,
  name: "Cycle 1",
  description: "",
  startDate: "2026-07-01",
  endDate: "2026-07-14",
  status: "active",
  createdAt: "2026-07-01T00:00:00.000Z",
};

function data(): BootstrapData {
  return {
    workspace: { id: "workspace_1", timezone: "Asia/Shanghai" },
    teams: [{
      id: "team_1",
      workspaceId: "workspace_1",
      name: "Engineering",
      key: "ENG",
      color: "#5e6ad2",
    }],
    cycles: [currentCycle],
    issues: [],
    states: [],
    memberships: [],
  } as unknown as BootstrapData;
}

beforeEach(() => workspace.useWorkspace.mockReset());
afterEach(cleanup);

describe("CyclesHub", () => {
  it("creates the next inclusive two-week cycle without sharing a boundary day", async () => {
    const created = {
      ...currentCycle,
      id: "cycle_2",
      number: 2,
      name: "Cycle 2",
      startDate: "2026-07-15",
      endDate: "2026-07-28",
      status: "upcoming" as const,
    };
    const mutate = vi.fn().mockResolvedValue(created);
    const onNavigate = vi.fn();
    workspace.useWorkspace.mockReturnValue({
      data: data(),
      mutate,
      setSelectedIssueId: vi.fn(),
    });

    render(<CyclesHub onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "新建周期" }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        "cycle.create",
        {
          teamId: "team_1",
          number: 2,
          name: "Cycle 2",
          startDate: "2026-07-15",
          endDate: "2026-07-28",
          status: "upcoming",
        },
        { successMessage: "下一周期已创建" },
      );
    });
    expect(onNavigate).toHaveBeenCalledWith({ section: "cycles", details: "cycle_2" });
  });
});
