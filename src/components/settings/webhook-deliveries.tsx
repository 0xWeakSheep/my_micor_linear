"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { RotateCcw } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import type {
  ActionResult,
  Webhook,
  WebhookDeliveryPage,
  WebhookDeliveryReplay,
  WebhookDeliveryStatus,
  WebhookDeliverySummary,
  WebhookReplayBlockReason,
} from "@/lib/domain";

const PAGE_SIZE = 20;
const POLL_INTERVAL_MS = 5_000;

const STATUS_DETAILS: Record<
  WebhookDeliveryStatus,
  { label: string; variant: NonNullable<BadgeProps["variant"]> }
> = {
  queued: { label: "排队中", variant: "info" },
  retrying: { label: "重试中", variant: "warning" },
  delivered: { label: "已送达", variant: "success" },
  failed: { label: "失败", variant: "danger" },
};

const REPLAY_BLOCK_LABELS: Record<WebhookReplayBlockReason, string> = {
  delivery_not_failed: "仅最终失败的投递可以重放",
  event_pending: "事件仍在处理中",
  event_unavailable: "原始事件已不可用",
  newer_delivery_exists: "已有更新的投递记录",
  signing_key_unavailable: "请先配置签名密钥",
  webhook_inactive: "请先启用 Webhook",
};

interface DeliveryLoadError {
  message: string;
  source: "first" | "more" | "background";
}

export interface WebhookDeliveriesDialogProps {
  webhook: Webhook;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function mergeFirstPage(
  current: WebhookDeliverySummary[],
  incoming: WebhookDeliverySummary[],
): WebhookDeliverySummary[] {
  const incomingIds = new Set(incoming.map((delivery) => delivery.id));
  return [
    ...incoming,
    ...current.filter((delivery) => !incomingIds.has(delivery.id)),
  ];
}

function mergeNextPage(
  current: WebhookDeliverySummary[],
  incoming: WebhookDeliverySummary[],
): WebhookDeliverySummary[] {
  const incomingById = new Map(incoming.map((delivery) => [delivery.id, delivery]));
  const currentIds = new Set(current.map((delivery) => delivery.id));
  return [
    ...current.map((delivery) => incomingById.get(delivery.id) ?? delivery),
    ...incoming.filter((delivery) => !currentIds.has(delivery.id)),
  ];
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "无法加载 Webhook 投递记录";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function requestUrl(workspaceSlug: string, webhookId: string, cursor?: string): string {
  const base = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/webhooks/${encodeURIComponent(webhookId)}/deliveries`;
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) query.set("cursor", cursor);
  return `${base}?${query.toString()}`;
}

async function fetchDeliveryPage(
  workspaceSlug: string,
  webhookId: string,
  signal: AbortSignal,
  cursor?: string,
): Promise<WebhookDeliveryPage> {
  const response = await fetch(requestUrl(workspaceSlug, webhookId, cursor), {
    cache: "no-store",
    signal,
  });
  const result = (await response.json()) as ActionResult<WebhookDeliveryPage>;
  if (!response.ok || !result.ok || !result.data) {
    throw new Error(result.error ?? "无法加载 Webhook 投递记录");
  }
  return result.data;
}

export function WebhookDeliveriesDialog({
  webhook,
  open,
  onOpenChange,
}: WebhookDeliveriesDialogProps) {
  const { data, mutate } = useWorkspace();
  const [items, setItems] = useState<WebhookDeliverySummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<DeliveryLoadError | null>(null);
  const [replayingDeliveryId, setReplayingDeliveryId] = useState<string | null>(null);
  const generationRef = useRef(0);
  const firstPageAbortRef = useRef<AbortController | null>(null);
  const nextPageAbortRef = useRef<AbortController | null>(null);
  const workspaceSlug = data.workspace.slug;

  const loadFirstPage = useCallback(
    async ({
      background,
      generation = generationRef.current,
    }: {
      background: boolean;
      generation?: number;
    }) => {
      firstPageAbortRef.current?.abort();
      const controller = new AbortController();
      firstPageAbortRef.current = controller;

      if (!background) {
        setLoading(true);
        setItems([]);
        setNextCursor(null);
      }
      setError(null);

      try {
        const page = await fetchDeliveryPage(
          workspaceSlug,
          webhook.id,
          controller.signal,
        );
        if (controller.signal.aborted || generationRef.current !== generation) return;

        const applyPage = () => {
          setItems((current) =>
            background ? mergeFirstPage(current, page.items) : page.items,
          );
          setNextCursor((current) =>
            background && current ? current : page.nextCursor,
          );
          setError(null);
        };
        if (background) startTransition(applyPage);
        else applyPage();
      } catch (caught) {
        if (controller.signal.aborted || generationRef.current !== generation) return;
        const applyError = () =>
          setError({
            message: errorMessage(caught),
            source: background ? "background" : "first",
          });
        if (background) startTransition(applyError);
        else applyError();
      } finally {
        if (
          !controller.signal.aborted &&
          generationRef.current === generation
        ) {
          setLoading(false);
        }
        if (firstPageAbortRef.current === controller) {
          firstPageAbortRef.current = null;
        }
      }
    },
    [webhook.id, workspaceSlug],
  );

  const loadNextPage = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const generation = generationRef.current;
    const cursor = nextCursor;
    nextPageAbortRef.current?.abort();
    const controller = new AbortController();
    nextPageAbortRef.current = controller;
    setLoadingMore(true);
    setError(null);

    try {
      const page = await fetchDeliveryPage(
        workspaceSlug,
        webhook.id,
        controller.signal,
        cursor,
      );
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setItems((current) => mergeNextPage(current, page.items));
      setNextCursor(page.nextCursor);
    } catch (caught) {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setError({ message: errorMessage(caught), source: "more" });
    } finally {
      if (
        !controller.signal.aborted &&
        generationRef.current === generation
      ) {
        setLoadingMore(false);
      }
      if (nextPageAbortRef.current === controller) {
        nextPageAbortRef.current = null;
      }
    }
  }, [loadingMore, nextCursor, webhook.id, workspaceSlug]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    firstPageAbortRef.current?.abort();
    nextPageAbortRef.current?.abort();

    if (open) {
      void loadFirstPage({ background: false, generation });
    }

    return () => {
      firstPageAbortRef.current?.abort();
      nextPageAbortRef.current?.abort();
    };
  }, [loadFirstPage, open]);

  const hasPendingDeliveries = items.some(
    (delivery) => delivery.status === "queued" || delivery.status === "retrying",
  );

  useEffect(() => {
    if (!open || !hasPendingDeliveries) return;
    const generation = generationRef.current;
    const timer = window.setInterval(() => {
      void loadFirstPage({ background: true, generation });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasPendingDeliveries, loadFirstPage, open]);

  async function replay(deliveryId: string) {
    const generation = generationRef.current;
    setReplayingDeliveryId(deliveryId);
    try {
      const result = await mutate<WebhookDeliveryReplay>(
        "webhook.delivery.replay",
        { webhookId: webhook.id, deliveryId },
        { refresh: false, successMessage: "已加入重放队列" },
      );
      if (result && generationRef.current === generation) {
        await loadFirstPage({ background: true, generation });
      }
    } finally {
      setReplayingDeliveryId(null);
    }
  }

  function retryLoad() {
    if (error?.source === "more") {
      void loadNextPage();
      return;
    }
    void loadFirstPage({
      background: items.length > 0,
      generation: generationRef.current,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="overflow-hidden p-0">
        <DialogHeader className="pr-12">
          <DialogTitle>{webhook.name} 的投递记录</DialogTitle>
          <DialogDescription>
            查看最近的 Webhook 请求、失败原因，并重放最终失败的投递。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[min(68dvh,620px)] overflow-y-auto border-t border-border">
          {loading ? (
            <div
              className="grid min-h-40 place-items-center px-5 py-10 text-sm text-tertiary"
              role="status"
              aria-live="polite"
            >
              正在加载投递记录…
            </div>
          ) : null}

          {!loading && error ? (
            <div
              className="flex flex-wrap items-center gap-3 border-b border-danger/20 bg-[var(--danger-soft)] px-5 py-3 text-sm text-danger"
              role="alert"
            >
              <span className="min-w-0 flex-1">{error.message}</span>
              <Button variant="outline" size="sm" onClick={retryLoad}>
                重试
              </Button>
            </div>
          ) : null}

          {!loading && !items.length && !error ? (
            <div className="grid min-h-40 place-items-center px-5 py-10 text-center">
              <div>
                <p className="text-sm font-medium text-primary">暂无投递记录</p>
                <p className="mt-1 text-xs text-tertiary">
                  Webhook 收到订阅事件后，投递结果会显示在这里。
                </p>
              </div>
            </div>
          ) : null}

          {!loading && items.length ? (
            <ul className="divide-y divide-border" aria-label="Webhook 投递记录">
              {items.map((delivery) => (
                <DeliveryRow
                  key={delivery.id}
                  delivery={delivery}
                  replaying={replayingDeliveryId === delivery.id}
                  replayDisabled={replayingDeliveryId !== null}
                  onReplay={replay}
                />
              ))}
            </ul>
          ) : null}

          {!loading && nextCursor ? (
            <div className="flex justify-center border-t border-border px-5 py-4">
              <Button
                variant="secondary"
                size="sm"
                loading={loadingMore}
                loadingLabel="加载中…"
                onClick={() => void loadNextPage()}
              >
                加载更多
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeliveryRow({
  delivery,
  replaying,
  replayDisabled,
  onReplay,
}: {
  delivery: WebhookDeliverySummary;
  replaying: boolean;
  replayDisabled: boolean;
  onReplay: (deliveryId: string) => Promise<void>;
}) {
  const status = STATUS_DETAILS[delivery.status];
  const resource = delivery.resourceType
    ? delivery.resourceId
      ? `${delivery.resourceType} · ${delivery.resourceId}`
      : delivery.resourceType
    : "工作区事件";

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all text-xs font-medium text-primary">
              {delivery.eventType}
            </code>
            <Badge variant={status.variant} size="xs">
              {status.label}
            </Badge>
          </div>
          <p className="mt-1 truncate text-xs text-tertiary" title={resource}>
            {resource}
          </p>
        </div>
        {delivery.canReplay ? (
          <Button
            variant="secondary"
            size="sm"
            loading={replaying}
            loadingLabel="加入中…"
            disabled={replayDisabled}
            startIcon={<RotateCcw size={13} aria-hidden="true" />}
            onClick={() => void onReplay(delivery.id)}
          >
            重放
          </Button>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-secondary">
        <span>第 {delivery.attempt} 次尝试</span>
        <span>
          {delivery.responseStatus === null
            ? "尚无 HTTP 响应"
            : `HTTP ${delivery.responseStatus}`}
        </span>
        <time dateTime={delivery.createdAt}>{formatTimestamp(delivery.createdAt)}</time>
        {delivery.nextAttemptAt ? (
          <span>
            下次重试：
            <time dateTime={delivery.nextAttemptAt}>
              {formatTimestamp(delivery.nextAttemptAt)}
            </time>
          </span>
        ) : null}
      </div>

      {delivery.status === "failed" && delivery.responseExcerpt ? (
        <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-surface-subtle px-2.5 py-2 font-mono text-[11px] leading-4 text-secondary">
          {delivery.responseExcerpt}
        </p>
      ) : null}

      {delivery.status === "failed" &&
      !delivery.canReplay &&
      delivery.replayBlockedReason ? (
        <p className="mt-2 text-[11px] text-tertiary">
          {REPLAY_BLOCK_LABELS[delivery.replayBlockedReason]}
        </p>
      ) : null}
    </li>
  );
}
