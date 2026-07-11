"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  AtSign,
  Bell,
  BellDot,
  CheckCheck,
  ChevronDown,
  Clock3,
  FileText,
  FolderKanban,
  MessageSquare,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  UserRoundCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { BootstrapData, Issue, Notification } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PriorityIcon, type IssuePriority } from "@/components/ui/priority-icon";
import { StatusIcon } from "@/components/ui/status-icon";

export interface InboxViewProps {
  workspaceSlug: string;
  onNavigate?: (path: string) => void;
}

interface NotificationVisual {
  icon: LucideIcon;
  label: string;
  tone: string;
}

const notificationVisuals: Array<[RegExp, NotificationVisual]> = [
  [/mention/i, { icon: AtSign, label: "提及", tone: "text-accent" }],
  [/assign/i, { icon: UserRoundCheck, label: "指派", tone: "text-[var(--info)]" }],
  [/comment|reply/i, { icon: MessageSquare, label: "评论", tone: "text-success" }],
  [/project|update/i, { icon: FolderKanban, label: "项目更新", tone: "text-warning" }],
];

const priorityMap: Record<Issue["priority"], IssuePriority> = {
  0: "none",
  1: "urgent",
  2: "high",
  3: "medium",
  4: "low",
};

function getNotificationVisual(type: string): NotificationVisual {
  return (
    notificationVisuals.find(([pattern]) => pattern.test(type))?.[1] ?? {
      icon: BellDot,
      label: "通知",
      tone: "text-secondary",
    }
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

function issueForNotification(
  notification: Notification,
  data: BootstrapData,
): Issue | undefined {
  if (notification.entityType === "issue") {
    return data.issues.find((issue) => issue.id === notification.entityId);
  }
  if (notification.entityType === "comment") {
    const comment = data.comments.find((item) => item.id === notification.entityId);
    return comment ? data.issues.find((issue) => issue.id === comment.issueId) : undefined;
  }
  return undefined;
}

function actorForNotification(notification: Notification, data: BootstrapData) {
  let userId: string | null = null;
  if (notification.entityType === "comment") {
    userId = data.comments.find((comment) => comment.id === notification.entityId)?.authorId ?? null;
  } else if (notification.entityType === "issue") {
    userId = data.issues.find((issue) => issue.id === notification.entityId)?.creatorId ?? null;
  } else if (notification.entityType === "project") {
    userId = data.projects.find((project) => project.id === notification.entityId)?.leadId ?? null;
  } else if (notification.entityType === "document") {
    userId = data.documents.find((document) => document.id === notification.entityId)?.creatorId ?? null;
  }
  return data.memberships.find((membership) => membership.userId === userId)?.user;
}

function NotificationTypeBadge({ type }: { type: string }) {
  const visual = getNotificationVisual(type);
  const Icon = visual.icon;
  return (
    <span
      className={cn(
        "absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full border-2 border-surface bg-surface-active",
        visual.tone,
      )}
      aria-label={visual.label}
    >
      <Icon className="size-2.5" strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}

function NotificationRow({
  notification,
  data,
  selected,
  pending,
  onSelect,
}: {
  notification: Notification;
  data: BootstrapData;
  selected: boolean;
  pending: boolean;
  onSelect: () => void;
}) {
  const actor = actorForNotification(notification, data);
  const issue = issueForNotification(notification, data);
  const state = issue ? data.states.find((item) => item.id === issue.statusId) : undefined;
  const project =
    notification.entityType === "project"
      ? data.projects.find((item) => item.id === notification.entityId)
      : undefined;
  const unread = notification.readAt === null;

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={`${unread ? "未读" : "已读"}：${notification.title}`}
      disabled={pending}
      onClick={onSelect}
      className={cn(
        "group relative flex min-h-[72px] w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
        selected ? "bg-surface-active" : "hover:bg-surface-hover",
        pending && "opacity-55",
      )}
    >
      <span className="relative shrink-0">
        <Avatar
          name={actor?.name ?? data.workspace.name}
          src={actor?.avatarUrl}
          size="lg"
        />
        <NotificationTypeBadge type={notification.type} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          {unread ? <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" /> : null}
          <span
            className={cn(
              "truncate text-[13px] text-primary",
              unread ? "font-semibold" : "font-medium text-secondary",
            )}
          >
            {issue ? `${issue.identifier} ${issue.title}` : project?.name ?? notification.title}
          </span>
        </span>
        <span className="mt-1 block truncate text-xs text-tertiary">
          {notification.body || notification.title}
        </span>
      </span>

      <span className="flex h-full shrink-0 flex-col items-end justify-between self-stretch py-0.5">
        {state ? (
          <StatusIcon status={state.type} color={state.color} size={16} label={state.name} />
        ) : project ? (
          <span className="size-3 rounded-[3px]" style={{ backgroundColor: project.color }} />
        ) : (
          <Bell className="size-3.5 text-tertiary" aria-hidden="true" />
        )}
        <time
          dateTime={notification.createdAt}
          className="text-[10px] tabular-nums text-tertiary"
          title={format(new Date(notification.createdAt), "yyyy-MM-dd HH:mm")}
        >
          {formatDistanceToNowStrict(new Date(notification.createdAt), {
            addSuffix: true,
            locale: zhCN,
          })}
        </time>
      </span>
    </button>
  );
}

function EmptyInbox({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex min-h-72 flex-1 flex-col items-center justify-center px-8 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface-subtle text-tertiary">
        {filtered ? <Search className="size-4" /> : <CheckCheck className="size-4" />}
      </span>
      <h2 className="mt-3 text-sm font-medium text-primary">
        {filtered ? "没有匹配通知" : "Inbox 已清空"}
      </h2>
      <p className="mt-1 max-w-60 text-xs leading-5 text-tertiary">
        {filtered ? "调整搜索词或显示选项后再试。" : "需要你关注的更新会出现在这里。"}
      </p>
    </div>
  );
}

function PreviewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border py-5 first:border-t-0">
      <h3 className="mb-2 text-[11px] font-medium text-tertiary">{title}</h3>
      {children}
    </section>
  );
}

function EntityPreview({
  notification,
  data,
  onOpenEntity,
}: {
  notification: Notification;
  data: BootstrapData;
  onOpenEntity: () => void;
}) {
  const issue = issueForNotification(notification, data);
  const comment =
    notification.entityType === "comment"
      ? data.comments.find((item) => item.id === notification.entityId)
      : undefined;
  const project =
    notification.entityType === "project"
      ? data.projects.find((item) => item.id === notification.entityId)
      : undefined;
  const document =
    notification.entityType === "document"
      ? data.documents.find((item) => item.id === notification.entityId)
      : undefined;

  if (issue) {
    const state = data.states.find((item) => item.id === issue.statusId);
    const assignee = data.memberships.find((item) => item.userId === issue.assigneeId)?.user;
    const projectForIssue = data.projects.find((item) => item.id === issue.projectId);
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-7 sm:px-9">
        <div className="flex flex-wrap items-center gap-2 text-xs text-tertiary">
          <span className="font-mono text-[11px]">{issue.identifier}</span>
          {state ? (
            <Badge
              variant="outline"
              size="xs"
              icon={<StatusIcon status={state.type} color={state.color} size={12} label={state.name} />}
            >
              {state.name}
            </Badge>
          ) : null}
        </div>
        <h2 className="mt-4 text-[26px] font-semibold leading-tight tracking-[-0.035em] text-primary">
          {issue.title}
        </h2>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-secondary">
          {issue.description || "这个 Issue 暂无描述。"}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            icon={<PriorityIcon priority={priorityMap[issue.priority]} size={12} />}
          >
            {priorityMap[issue.priority] === "none" ? "无优先级" : "优先级"}
          </Badge>
          {assignee ? (
            <Badge variant="outline" icon={<Avatar name={assignee.name} src={assignee.avatarUrl} size="xs" />}>
              {assignee.name}
            </Badge>
          ) : null}
          {projectForIssue ? (
            <Badge
              variant="outline"
              icon={<span className="size-2 rounded-[2px]" style={{ background: projectForIssue.color }} />}
            >
              {projectForIssue.name}
            </Badge>
          ) : null}
        </div>

        {comment ? (
          <PreviewSection title="相关评论">
            <blockquote className="rounded-lg border border-border bg-surface-subtle px-4 py-3 text-sm leading-6 text-secondary">
              {comment.body}
            </blockquote>
          </PreviewSection>
        ) : null}

        <PreviewSection title="通知内容">
          <p className="text-sm leading-6 text-secondary">{notification.body}</p>
        </PreviewSection>

        <Button variant="secondary" size="sm" onClick={onOpenEntity}>
          打开 Issue
        </Button>
      </div>
    );
  }

  if (project) {
    const lead = data.memberships.find((item) => item.userId === project.leadId)?.user;
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8 sm:px-9">
        <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface-subtle">
          <FolderKanban className="size-4" style={{ color: project.color }} />
        </div>
        <h2 className="mt-4 text-[26px] font-semibold tracking-[-0.035em]">{project.name}</h2>
        <p className="mt-2 text-sm leading-6 text-secondary">{project.summary}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Badge variant="outline">{project.status}</Badge>
          {lead ? (
            <Badge variant="outline" icon={<Avatar name={lead.name} src={lead.avatarUrl} size="xs" />}>
              {lead.name}
            </Badge>
          ) : null}
          {project.targetDate ? <Badge variant="outline">目标 {project.targetDate}</Badge> : null}
        </div>
        <PreviewSection title="更新">
          <p className="text-sm leading-6 text-secondary">{notification.body}</p>
        </PreviewSection>
        <Button variant="secondary" size="sm" onClick={onOpenEntity}>
          打开项目
        </Button>
      </div>
    );
  }

  if (document) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8 sm:px-9">
        <FileText className="size-7 text-tertiary" />
        <h2 className="mt-4 text-[26px] font-semibold tracking-[-0.035em]">{document.title}</h2>
        <p className="mt-4 max-h-80 overflow-hidden whitespace-pre-wrap text-sm leading-6 text-secondary">
          {document.content}
        </p>
        <PreviewSection title="通知内容">
          <p className="text-sm leading-6 text-secondary">{notification.body}</p>
        </PreviewSection>
        <Button variant="secondary" size="sm" onClick={onOpenEntity}>
          打开文档
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center px-8 py-10 text-center">
      <Bell className="mx-auto size-7 text-tertiary" />
      <h2 className="mt-4 text-lg font-semibold">{notification.title}</h2>
      <p className="mt-2 text-sm leading-6 text-secondary">{notification.body}</p>
    </div>
  );
}

export function InboxView({ workspaceSlug, onNavigate }: InboxViewProps) {
  const router = useRouter();
  const { data, mutate, setSelectedIssueId } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showRead, setShowRead] = useState(true);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [markingAll, setMarkingAll] = useState(false);
  const [referenceTime] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement>(null);

  const visibleNotifications = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return data.notifications.filter((notification) => {
      if (!showRead && notification.readAt) return false;
      const snoozed =
        notification.snoozedUntil !== null &&
        new Date(notification.snoozedUntil).getTime() > referenceTime;
      if (!showSnoozed && snoozed) return false;
      if (!normalizedQuery) return true;
      const issue = issueForNotification(notification, data);
      return [
        notification.title,
        notification.body,
        notification.type,
        issue?.identifier,
        issue?.title,
      ]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [data, query, referenceTime, showRead, showSnoozed]);

  const activeNotification =
    visibleNotifications.find((notification) => notification.id === selectedId) ??
    visibleNotifications[0];
  const unreadCount = data.notifications.filter((notification) => notification.readAt === null).length;

  const runNotificationAction = useCallback(
    async (
      notificationId: string,
      action: "markRead" | "markUnread" | "snooze" | "archive",
      extra: Record<string, unknown> = {},
      successMessage?: string,
    ) => {
      setPendingIds((current) => new Set(current).add(notificationId));
      const result = await mutate<boolean>(
        `notification.${action}`,
        { notificationId, ...extra },
        { successMessage },
      );
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(notificationId);
        return next;
      });
      return Boolean(result);
    },
    [mutate],
  );

  const selectNotification = useCallback(
    (notification: Notification) => {
      setSelectedId(notification.id);
      if (!notification.readAt && !pendingIds.has(notification.id)) {
        void runNotificationAction(notification.id, "markRead");
      }
    },
    [pendingIds, runNotificationAction],
  );

  const navigate = useCallback(
    (path: string) => {
      if (onNavigate) onNavigate(path);
      else router.push(`/${workspaceSlug}/${path}`);
    },
    [onNavigate, router, workspaceSlug],
  );

  const openEntity = useCallback(
    (notification: Notification) => {
      const issue = issueForNotification(notification, data);
      if (issue) {
        setSelectedIssueId(issue.id);
        return;
      }
      const plural = notification.entityType === "initiative" ? "initiatives" : `${notification.entityType}s`;
      navigate(`${plural}/${notification.entityId}`);
    },
    [data, navigate, setSelectedIssueId],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "Escape" && query) {
        event.preventDefault();
        setQuery("");
        searchRef.current?.blur();
        return;
      }
      if (isTypingTarget(event.target)) return;

      const index = Math.max(
        0,
        activeNotification
          ? visibleNotifications.findIndex((item) => item.id === activeNotification.id)
          : 0,
      );
      if (["ArrowDown", "j", "J"].includes(event.key) && visibleNotifications.length > 0) {
        event.preventDefault();
        const next = visibleNotifications[Math.min(index + 1, visibleNotifications.length - 1)];
        if (next) selectNotification(next);
      } else if (["ArrowUp", "k", "K"].includes(event.key) && visibleNotifications.length > 0) {
        event.preventDefault();
        const next = visibleNotifications[Math.max(index - 1, 0)];
        if (next) selectNotification(next);
      } else if (event.key === "Enter" && activeNotification) {
        event.preventDefault();
        openEntity(activeNotification);
      } else if (event.key.toLowerCase() === "u" && activeNotification) {
        event.preventDefault();
        if (event.altKey) {
          setMarkingAll(true);
          void mutate<boolean>("notification.markAllRead", {}, { successMessage: "全部通知已标为已读" }).finally(
            () => setMarkingAll(false),
          );
        } else {
          void runNotificationAction(
            activeNotification.id,
            activeNotification.readAt ? "markUnread" : "markRead",
          );
        }
      } else if (event.key.toLowerCase() === "h" && activeNotification) {
        event.preventDefault();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        void runNotificationAction(
          activeNotification.id,
          "snooze",
          { until: tomorrow.toISOString() },
          "通知已推迟到明天",
        );
        setSelectedId(null);
      } else if (event.key === "Backspace" && activeNotification) {
        event.preventDefault();
        void runNotificationAction(activeNotification.id, "archive", {}, "通知已归档");
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeNotification,
    mutate,
    openEntity,
    query,
    runNotificationAction,
    selectNotification,
    visibleNotifications,
  ]);

  const markAllRead = async () => {
    setMarkingAll(true);
    await mutate<boolean>("notification.markAllRead", {}, { successMessage: "全部通知已标为已读" });
    setMarkingAll(false);
  };

  return (
    <div className="flex h-full min-h-0 bg-surface">
      <section
        aria-label="Inbox notifications"
        className={cn(
          "min-h-0 w-full flex-col border-r border-border bg-surface md:flex md:w-[min(440px,44%)] md:min-w-[340px]",
          selectedId ? "hidden md:flex" : "flex",
        )}
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <h1 className="text-sm font-semibold tracking-[-0.015em]">Inbox</h1>
          {unreadCount > 0 ? (
            <Badge variant="accent" size="xs">{unreadCount}</Badge>
          ) : null}
          <div className="ml-auto flex items-center gap-0.5">
            <IconButton
              label="全部标为已读"
              tooltip="全部标为已读"
              icon={<CheckCheck className="size-4" />}
              variant="ghost"
              size="icon-sm"
              loading={markingAll}
              disabled={unreadCount === 0}
              onClick={() => void markAllRead()}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex size-7 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label="Inbox display options"
                >
                  <SlidersHorizontal className="size-4" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>显示</DropdownMenuLabel>
                <DropdownMenuCheckboxItem checked={showRead} onCheckedChange={setShowRead}>
                  已读通知
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={showSnoozed} onCheckedChange={setShowSnoozed}>
                  已推迟通知
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="shrink-0 border-b border-border p-2.5">
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            startIcon={<Search className="size-3.5" />}
            endAdornment={
              query ? (
                <button type="button" onClick={() => setQuery("")} aria-label="清空搜索">
                  <X className="size-3.5" />
                </button>
              ) : (
                <kbd className="font-sans text-[9px]">⌘F</kbd>
              )
            }
            placeholder="搜索通知…"
            aria-label="搜索 Inbox"
          />
        </div>

        <div
          role="listbox"
          aria-label="Notifications"
          className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2"
        >
          {visibleNotifications.length > 0 ? (
            visibleNotifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                data={data}
                selected={activeNotification?.id === notification.id}
                pending={pendingIds.has(notification.id)}
                onSelect={() => selectNotification(notification)}
              />
            ))
          ) : (
            <EmptyInbox filtered={Boolean(query || !showRead || !showSnoozed)} />
          )}
        </div>

        <footer className="hidden h-8 shrink-0 items-center gap-3 border-t border-border px-3 text-[10px] text-tertiary lg:flex">
          <span><kbd>J/K</kbd> 移动</span>
          <span><kbd>U</kbd> 已读</span>
          <span><kbd>H</kbd> 推迟</span>
          <span className="ml-auto"><kbd>⌫</kbd> 归档</span>
        </footer>
      </section>

      <section
        aria-label="Notification details"
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col bg-background",
          selectedId ? "flex" : "hidden md:flex",
        )}
      >
        {activeNotification ? (
          <>
            <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
              <IconButton
                label="返回 Inbox"
                icon={<ArrowLeft className="size-4" />}
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                onClick={() => setSelectedId(null)}
              />
              <span className="ml-1 min-w-0 flex-1 truncate text-xs font-medium text-secondary">
                {activeNotification.title}
              </span>
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-secondary hover:bg-surface-hover hover:text-primary"
                onClick={() =>
                  void runNotificationAction(
                    activeNotification.id,
                    activeNotification.readAt ? "markUnread" : "markRead",
                  )
                }
              >
                {activeNotification.readAt ? <BellDot className="size-3.5" /> : <CheckCheck className="size-3.5" />}
                {activeNotification.readAt ? "标为未读" : "标为已读"}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-secondary hover:bg-surface-hover hover:text-primary"
                  >
                    <Clock3 className="size-3.5" /> 推迟 <ChevronDown className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>提醒时间</DropdownMenuLabel>
                  {[
                    { label: "1 小时后", hours: 1 },
                    { label: "明天", hours: 24 },
                    { label: "下周", hours: 24 * 7 },
                  ].map((option) => (
                    <DropdownMenuItem
                      key={option.label}
                      onSelect={() => {
                        const until = new Date(Date.now() + option.hours * 60 * 60 * 1000);
                        void runNotificationAction(
                          activeNotification.id,
                          "snooze",
                          { until: until.toISOString() },
                          `通知已推迟到${option.label}`,
                        );
                        setSelectedId(null);
                      }}
                    >
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex size-7 items-center justify-center rounded-md text-tertiary hover:bg-surface-hover hover:text-primary"
                    aria-label="Notification actions"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    destructive
                    icon={<Archive className="size-3.5" />}
                    onSelect={() => {
                      void runNotificationAction(activeNotification.id, "archive", {}, "通知已归档");
                      setSelectedId(null);
                    }}
                  >
                    归档通知
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled>键盘快捷键：Backspace</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <EntityPreview
                notification={activeNotification}
                data={data}
                onOpenEntity={() => openEntity(activeNotification)}
              />
            </div>
          </>
        ) : (
          <div className="grid h-full place-items-center text-sm text-tertiary">选择一条通知查看详情</div>
        )}
      </section>
    </div>
  );
}
