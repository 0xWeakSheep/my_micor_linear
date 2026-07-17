import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BootstrapData, Webhook } from "@/lib/domain";

const workspace = vi.hoisted(() => ({ useWorkspace: vi.fn() }));

vi.mock("@/components/workspace/workspace-provider", () => ({
  useWorkspace: workspace.useWorkspace,
}));

import { ApiSettings } from "./developer-settings";

const webhook: Webhook = {
  id: "hook_main",
  workspaceId: "ws_test",
  name: "Primary hook",
  url: "https://hooks.example.com/original",
  events: ["issue.created"],
  isActive: true,
  signingReady: true,
  createdAt: "2026-07-17T00:00:00.000Z",
};

function data(currentWebhook: Webhook = webhook): BootstrapData {
  return {
    workspace: { id: "ws_test", slug: "test" },
    apiKeys: [],
    webhooks: [currentWebhook],
  } as unknown as BootstrapData;
}

beforeEach(() => workspace.useWorkspace.mockReset());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("webhook settings", () => {
  it("validates edited endpoints and trims the submitted values", async () => {
    const mutate = vi.fn().mockResolvedValue({ webhook });
    workspace.useWorkspace.mockReturnValue({ data: data(), mutate });
    render(<ApiSettings />);

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const url = screen.getByLabelText("URL");
    fireEvent.change(url, { target: { value: "http://internal.example.com/hook" } });
    expect(url).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    fireEvent.change(screen.getAllByLabelText("名称")[1]!, {
      target: { value: "  Updated hook  " },
    });
    fireEvent.change(url, {
      target: { value: "  https://hooks.example.com/updated  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        "webhook.update",
        {
          webhookId: "hook_main",
          changes: {
            name: "Updated hook",
            url: "https://hooks.example.com/updated",
            events: ["issue.created"],
            isActive: true,
          },
        },
        { successMessage: "Webhook 已更新" },
      );
    });
  });

  it("starts editing from the latest server value and warns that history is deleted", () => {
    const mutate = vi.fn();
    let currentData = data();
    workspace.useWorkspace.mockImplementation(() => ({ data: currentData, mutate }));
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const view = render(<ApiSettings />);

    currentData = data({
      ...webhook,
      url: "https://hooks.example.com/from-server",
      events: ["issue.updated"],
    });
    view.rerender(<ApiSettings />);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("URL")).toHaveValue(
      "https://hooks.example.com/from-server",
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByRole("button", { name: "删除 Primary hook" }));
    expect(confirm).toHaveBeenCalledWith(
      "删除 Webhook“Primary hook”？相关投递记录也会永久删除。",
    );
    expect(mutate).not.toHaveBeenCalled();
  });
});
