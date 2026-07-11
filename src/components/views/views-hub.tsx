"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Eye,
  LayoutGrid,
  List,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import type { SavedView, ViewFilters } from "@/lib/domain";
import { filterIssues } from "@/modules/views/filter";
import { IssuesView } from "@/components/issues/issues-view";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { ViewEditor } from "./view-editor";
import type { ViewsHubProps } from "./types";

export function ViewsHub({ details, onNavigate }: ViewsHubProps) {
  const { data, preferences, setPreferences, mutate } = useWorkspace();
  const [internalDetails, setInternalDetails] = useState<string | null>(details ?? null);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<{ open: boolean; viewId?: string }>({ open: false });
  const [deleteView, setDeleteView] = useState<SavedView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const activeDetails = details === undefined ? internalDetails : details;
  const activeView = data.views.find((view) => view.id === activeDetails) ?? null;

  const navigate = useCallback(
    (viewId: string | null) => {
      setInternalDetails(viewId);
      onNavigate?.(viewId);
    },
    [onNavigate],
  );

  useEffect(() => {
    if (!activeView) return;
    const needsLayout = preferences.layout !== activeView.layout;
    const hasTransientFilters = Object.keys(preferences.filters).length > 0;
    if (needsLayout || hasTransientFilters) {
      setPreferences({ layout: activeView.layout, filters: {} });
    }
  }, [activeView, preferences.filters, preferences.layout, setPreferences]);

  const matchingIssues = useMemo(
    () =>
      activeView
        ? filterIssues(data.issues, activeView.filters, { comments: data.comments })
        : [],
    [activeView, data.comments, data.issues],
  );

  async function confirmDelete() {
    if (!deleteView) return;
    setDeleting(true);
    const deleted = await mutate<boolean>(
      "view.delete",
      { viewId: deleteView.id },
      { successMessage: "视图已删除" },
    );
    setDeleting(false);
    if (deleted) {
      if (activeDetails === deleteView.id) navigate(null);
      setDeleteView(null);
    }
  }

  if (activeView) {
    const canManage =
      activeView.creatorId === data.currentUser.id || data.currentMembership.role === "admin";
    return (
      <div className="flex h-full min-h-0 flex-col bg-surface">
        <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-5">
          <IconButton
            label="返回视图列表"
            icon={<ArrowLeft size={15} />}
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate(null)}
          />
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: activeView.color }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold tracking-[-0.015em]">
                {activeView.name}
              </h1>
              <Badge
                size="xs"
                variant={activeView.isShared ? "accent" : "neutral"}
                icon={activeView.isShared ? <Share2 size={10} /> : <Lock size={10} />}
              >
                {activeView.isShared ? "共享" : "个人"}
              </Badge>
            </div>
            {activeView.description ? (
              <p className="hidden truncate text-[11px] text-tertiary sm:block">
                {activeView.description}
              </p>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Badge variant="outline" size="xs">
              {describeFilters(activeView.filters)}
            </Badge>
            {canManage ? (
              <>
                <IconButton
                  label="编辑视图"
                  tooltip="编辑视图"
                  icon={<Pencil size={14} />}
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setEditor({ open: true, viewId: activeView.id })}
                />
                <IconButton
                  label="删除视图"
                  tooltip="删除视图"
                  icon={<Trash2 size={14} />}
                  variant="ghost"
                  size="icon-sm"
                  className="text-tertiary hover:text-danger"
                  onClick={() => setDeleteView(activeView)}
                />
              </>
            ) : null}
          </div>
        </header>
        <div className="min-h-0 flex-1">
          <IssuesView
            issues={matchingIssues}
            description={`${matchingIssues.length} 个 Issue · ${describeFilters(activeView.filters)}`}
          />
        </div>
        <ViewEditor
          key={`${editor.open}-${editor.viewId ?? "new"}`}
          open={editor.open}
          viewId={editor.viewId}
          onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
        />
        <DeleteViewDialog
          view={deleteView}
          loading={deleting}
          onOpenChange={(open) => !open && setDeleteView(null)}
          onConfirm={() => void confirmDelete()}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-7 sm:py-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-tertiary">
              <Eye size={12} /> 工作区视图
            </div>
            <h1 className="text-xl font-semibold tracking-[-0.03em]">视图</h1>
            <p className="mt-1 max-w-2xl text-sm text-secondary">
              把常用筛选保存为个人或共享视图，快速回到同一组工作。
            </p>
          </div>
          <Button
            variant="primary"
            size="md"
            startIcon={<Plus size={15} />}
            onClick={() => setEditor({ open: true })}
          >
            新建视图
          </Button>
        </header>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            startIcon={<Search size={14} />}
            placeholder="搜索视图…"
            aria-label="搜索视图"
            containerClassName="max-w-sm"
          />
          <p className="text-[11px] text-tertiary">{data.views.length} 个已保存视图</p>
        </div>

        <ViewGrid
          query={query}
          onOpen={(view) => navigate(view.id)}
          onEdit={(view) => setEditor({ open: true, viewId: view.id })}
          onDelete={setDeleteView}
          onCreate={() => setEditor({ open: true })}
        />
      </div>

      <ViewEditor
        key={`${editor.open}-${editor.viewId ?? "new"}`}
        open={editor.open}
        viewId={editor.viewId}
        onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
        onSaved={(viewId) => {
          if (viewId) navigate(viewId);
        }}
      />
      <DeleteViewDialog
        view={deleteView}
        loading={deleting}
        onOpenChange={(open) => !open && setDeleteView(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function ViewGrid({
  query,
  onOpen,
  onEdit,
  onDelete,
  onCreate,
}: {
  query: string;
  onOpen: (view: SavedView) => void;
  onEdit: (view: SavedView) => void;
  onDelete: (view: SavedView) => void;
  onCreate: () => void;
}) {
  const { data } = useWorkspace();
  const normalized = query.trim().toLocaleLowerCase();
  const views = data.views.filter((view) =>
    [view.name, view.description].some((value) => value.toLocaleLowerCase().includes(normalized)),
  );

  if (!views.length) {
    return (
      <div className="mt-5 rounded-xl border border-dashed border-border-strong bg-surface-subtle px-5 py-14 text-center">
        <span className="mx-auto grid size-10 place-items-center rounded-lg border border-border bg-surface text-tertiary">
          <SlidersHorizontal size={18} />
        </span>
        <h2 className="mt-3 text-sm font-medium">
          {query ? "没有匹配的视图" : "还没有保存视图"}
        </h2>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-tertiary">
          {query
            ? "换一个关键词，或清空搜索后查看全部视图。"
            : "把团队、状态、优先级等筛选组合保存下来，之后一键打开。"}
        </p>
        {!query ? (
          <Button className="mt-4" variant="secondary" size="sm" onClick={onCreate}>
            创建第一个视图
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {views.map((view) => {
        const owner = data.memberships.find((member) => member.userId === view.creatorId)?.user;
        const issueCount = filterIssues(data.issues, view.filters, {
          comments: data.comments,
        }).length;
        const canManage =
          view.creatorId === data.currentUser.id || data.currentMembership.role === "admin";
        return (
          <article
            key={view.id}
            className="group relative flex min-h-44 flex-col rounded-xl border border-border bg-surface-raised p-4 transition-colors hover:border-border-strong hover:bg-surface-hover"
          >
            <button
              type="button"
              aria-label={`打开视图 ${view.name}`}
              className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              onClick={() => onOpen(view)}
            />
            <div className="pointer-events-none relative flex items-start gap-3">
              <span
                className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface text-secondary"
                style={{ color: view.color }}
              >
                {view.layout === "board" ? <LayoutGrid size={17} /> : <List size={17} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-sm font-semibold tracking-[-0.01em]">{view.name}</h2>
                  {view.isShared ? <Share2 size={11} className="shrink-0 text-tertiary" /> : <Lock size={11} className="shrink-0 text-tertiary" />}
                </div>
                <p className="mt-1 line-clamp-2 min-h-8 text-xs leading-4 text-tertiary">
                  {view.description || "没有描述"}
                </p>
              </div>
            </div>
            <div className="pointer-events-none relative mt-4 flex flex-wrap gap-1.5">
              <Badge variant="outline" size="xs">
                {issueCount} issues
              </Badge>
              <Badge variant="neutral" size="xs">
                {describeFilters(view.filters)}
              </Badge>
              <Badge variant="neutral" size="xs">
                {view.layout === "board" ? "看板" : "列表"}
              </Badge>
            </div>
            <div className="pointer-events-none relative mt-auto flex items-end justify-between pt-4 text-[10px] text-tertiary">
              <span className="truncate">{owner?.name ?? "未知成员"}</span>
              <span>{formatRelativeDate(view.updatedAt)}</span>
            </div>
            {canManage ? (
              <div className="absolute right-2 top-2 z-10 flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <IconButton
                  label={`编辑 ${view.name}`}
                  icon={<Pencil size={13} />}
                  variant="secondary"
                  size="icon-xs"
                  onClick={() => onEdit(view)}
                />
                <IconButton
                  label={`删除 ${view.name}`}
                  icon={<Trash2 size={13} />}
                  variant="secondary"
                  size="icon-xs"
                  className="ml-1 hover:text-danger"
                  onClick={() => onDelete(view)}
                />
              </div>
            ) : (
              <MoreHorizontal className="absolute right-3 top-3 text-tertiary" size={14} />
            )}
          </article>
        );
      })}
    </div>
  );
}

function DeleteViewDialog({
  view,
  loading,
  onOpenChange,
  onConfirm,
}: {
  view: SavedView | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={Boolean(view)} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>删除视图？</DialogTitle>
          <DialogDescription>
            “{view?.name}”将从工作区中永久删除，Issue 本身不会受到影响。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="danger" loading={loading} onClick={onConfirm}>
            删除视图
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function describeFilters(filters: ViewFilters): string {
  const count = [
    filters.teamIds,
    filters.statusIds,
    filters.priorities,
    filters.assigneeIds,
    filters.labelIds,
    filters.projectIds,
    filters.cycleIds,
    filters.creatorIds,
  ].filter((values) => values?.length).length + (filters.search?.trim() ? 1 : 0);
  if (!count) return "全部 Issue";
  return `${count} 组条件`;
}

function formatRelativeDate(value: string): string {
  const timestamp = new Date(value).getTime();
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return "今天更新";
  if (days === 1) return "昨天更新";
  if (days < 30) return `${days} 天前更新`;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(timestamp);
}
