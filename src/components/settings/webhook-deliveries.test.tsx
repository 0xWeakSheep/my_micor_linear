import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ActionResult,
  Webhook,
  WebhookDeliveryPage,
  WebhookDeliveryReplay,
  WebhookDeliverySummary,
} from "@/lib/domain";

const workspace = vi.hoisted(() => ({ useWorkspace: vi.fn() }));

vi.mock("@/components/workspace/workspace-provider", () => ({
  useWorkspace: workspace.useWorkspace,
}));

import { WebhookDeliveriesDialog } from "./webhook-deliveries";

const webhook: Webhook = {
  id: "hook_main",
  workspaceId: "workspace_1",
  name: "Data warehouse",
  url: "https://example.com/hooks/micro-linear",
  events: ["issue.created", "issue.updated"],
  isActive: true,
  signingReady: true,
  createdAt: "2026-07-17T00:00:00.000Z",
};

function delivery(
  overrides: Partial<WebhookDeliverySummary> = {},
): WebhookDeliverySummary {
  return {
    id: "delivery_1",
    webhookId: webhook.id,
    eventId: "event_1",
    eventType: "issue.created",
    resourceType: "issue",
    resourceId: "issue_1",
    status: "delivered",
    attempt: 1,
    responseStatus: 204,
    responseExcerpt: null,
    createdAt: "2026-07-17T01:00:00.000Z",
    deliveredAt: "2026-07-17T01:00:01.000Z",
    nextAttemptAt: null,
    replayOfDeliveryId: null,
    canReplay: false,
    replayBlockedReason: "delivery_not_failed",
    ...overrides,
  };
}

function response(
  page: WebhookDeliveryPage,
  init?: ResponseInit,
): Response {
  const result: ActionResult<WebhookDeliveryPage> = { ok: true, data: page };
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function errorResponse(message: string): Response {
  const result: ActionResult = { ok: false, error: message };
  return new Response(JSON.stringify(result), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
}

const mutate = vi.fn();

beforeEach(() => {
  workspace.useWorkspace.mockReset();
  mutate.mockReset();
  workspace.useWorkspace.mockReturnValue({
    data: { workspace: { slug: "micro-linear" } },
    mutate,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("WebhookDeliveriesDialog", () => {
  it("loads the first page when opened and exposes accessible loading and dialog text", async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WebhookDeliveriesDialog
        webhook={webhook}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Data warehouse 的投递记录" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载投递记录");
    expect(screen.getByText(/查看最近的 Webhook 请求/)).toBeInTheDocument();

    resolveFetch(response({ items: [delivery()], nextCursor: null }));

    expect(await screen.findByText("issue.created")).toBeInTheDocument();
    expect(screen.getByText("已送达")).toBeInTheDocument();
    expect(screen.getByText("HTTP 204")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/micro-linear/webhooks/hook_main/deliveries?limit=20",
      { cache: "no-store", signal: expect.any(AbortSignal) },
    );
  });

  it("shows a request error, retries it, and renders the empty state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse("暂时无法读取投递记录"))
      .mockResolvedValueOnce(response({ items: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WebhookDeliveriesDialog
        webhook={webhook}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法读取投递记录");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByText("暂无投递记录")).toBeInTheDocument();
    expect(screen.getByText(/Webhook 收到订阅事件后/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("appends cursor pages while updating duplicate deliveries only once", async () => {
    const duplicate = delivery({
      id: "delivery_2",
      eventId: "event_2",
      eventType: "issue.updated",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          items: [delivery(), duplicate],
          nextCursor: "cursor_1",
        }),
      )
      .mockResolvedValueOnce(
        response({
          items: [
            { ...duplicate, attempt: 2, responseStatus: 200 },
            delivery({
              id: "delivery_3",
              eventId: "event_3",
              eventType: "project.created",
              resourceType: "project",
              resourceId: "project_1",
            }),
          ],
          nextCursor: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WebhookDeliveriesDialog
        webhook={webhook}
        open
        onOpenChange={vi.fn()}
      />,
    );

    await screen.findByText("issue.updated");
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));

    expect(await screen.findByText("project.created")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByText("issue.updated")).toHaveLength(1);
    expect(screen.getByText("第 2 次尝试")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/workspaces/micro-linear/webhooks/hook_main/deliveries?limit=20&cursor=cursor_1",
      { cache: "no-store", signal: expect.any(AbortSignal) },
    );
  });

  it("queues an eligible replay with the exact action payload and refreshes the first page", async () => {
    const failed = delivery({
      id: "delivery_failed",
      status: "failed",
      responseStatus: 503,
      responseExcerpt: "upstream unavailable",
      deliveredAt: null,
      canReplay: true,
      replayBlockedReason: null,
    });
    const queued = delivery({
      id: "delivery_replay",
      eventId: "event_replay",
      status: "queued",
      responseStatus: null,
      deliveredAt: null,
      replayOfDeliveryId: failed.id,
      replayBlockedReason: "delivery_not_failed",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ items: [failed], nextCursor: null }))
      .mockResolvedValueOnce(response({ items: [queued, failed], nextCursor: null }));
    const replayResult: WebhookDeliveryReplay = {
      deliveryId: queued.id,
      eventId: queued.eventId,
      originalEventId: failed.eventId,
      rootDeliveryId: failed.id,
      queuedAt: "2026-07-17T02:00:00.000Z",
    };
    mutate.mockResolvedValue(replayResult);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <WebhookDeliveriesDialog
        webhook={webhook}
        open
        onOpenChange={vi.fn()}
      />,
    );

    await screen.findByText("upstream unavailable");
    fireEvent.click(screen.getByRole("button", { name: "重放" }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        "webhook.delivery.replay",
        { webhookId: webhook.id, deliveryId: failed.id },
        { refresh: false, successMessage: "已加入重放队列" },
      );
    });
    expect(await screen.findByText("排队中")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("polls while a delivery is pending and stops once it is delivered", async () => {
    const queued = delivery({
      status: "queued",
      responseStatus: null,
      deliveredAt: null,
    });
    const delivered = delivery();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ items: [queued], nextCursor: null }))
      .mockResolvedValueOnce(response({ items: [delivered], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    render(
      <WebhookDeliveriesDialog
        webhook={webhook}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("排队中")).toBeInTheDocument();
    await waitFor(() => expect(setIntervalSpy).toHaveBeenCalled());
    const poll = setIntervalSpy.mock.calls.find(
      ([, delay]) => delay === 5_000,
    )?.[0];
    expect(typeof poll).toBe("function");

    await act(async () => {
      if (typeof poll === "function") poll();
    });

    expect(await screen.findByText("已送达")).toBeInTheDocument();
    await waitFor(() => expect(clearIntervalSpy).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts an in-flight request when the controlled dialog closes", async () => {
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Promise<Response>(() => undefined);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();
    const view = render(
      <WebhookDeliveriesDialog
        webhook={webhook}
        open
        onOpenChange={onOpenChange}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = (fetchMock.mock.calls[0]?.[1] as RequestInit).signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    view.rerender(
      <WebhookDeliveriesDialog
        webhook={webhook}
        open={false}
        onOpenChange={onOpenChange}
      />,
    );

    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
