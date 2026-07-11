import type { ReactNode } from "react";
import { CalendarDays, Inbox } from "lucide-react";
import type {
  InitiativeStatus,
  Issue,
  Membership,
  ProjectHealth,
  ProjectStatus,
} from "@/lib/domain";
import { cn, initials } from "@/lib/utils";

const DATE_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
});

const MONTH_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  year: "2-digit",
  month: "short",
  timeZone: "UTC",
});

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: "计划中",
  started: "进行中",
  paused: "已暂停",
  completed: "已完成",
  canceled: "已取消",
};

export const INITIATIVE_STATUS_LABELS: Record<InitiativeStatus, string> = {
  planned: "计划中",
  active: "进行中",
  completed: "已完成",
  paused: "已暂停",
};

export const HEALTH_LABELS: Record<ProjectHealth, string> = {
  onTrack: "进展正常",
  atRisk: "存在风险",
  offTrack: "偏离计划",
};

const PRIORITY_LABELS: Record<Issue["priority"], string> = {
  0: "无优先级",
  1: "紧急",
  2: "高",
  3: "中",
  4: "低",
};

export function formatPriority(priority: Issue["priority"]): string {
  return PRIORITY_LABELS[priority];
}

export const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  planned: "bg-surface-subtle text-secondary border-border",
  started: "bg-accent-soft text-accent border-[color-mix(in_srgb,var(--accent)_26%,var(--border))]",
  paused: "bg-[var(--warning-soft)] text-warning border-[color-mix(in_srgb,var(--warning)_28%,var(--border))]",
  completed: "bg-[var(--success-soft)] text-success border-[color-mix(in_srgb,var(--success)_28%,var(--border))]",
  canceled: "bg-surface-subtle text-tertiary border-border",
};

export const INITIATIVE_STATUS_STYLES: Record<InitiativeStatus, string> = {
  planned: "bg-surface-subtle text-secondary border-border",
  active: "bg-accent-soft text-accent border-[color-mix(in_srgb,var(--accent)_26%,var(--border))]",
  completed: "bg-[var(--success-soft)] text-success border-[color-mix(in_srgb,var(--success)_28%,var(--border))]",
  paused: "bg-[var(--warning-soft)] text-warning border-[color-mix(in_srgb,var(--warning)_28%,var(--border))]",
};

export function formatPlanningDate(value: string | null): string {
  if (!value) return "未设置";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "未设置" : DATE_FORMAT.format(parsed);
}

export function StatusBadge({
  status,
}: {
  status: ProjectStatus;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center whitespace-nowrap rounded-md border px-2 text-xs font-medium",
        PROJECT_STATUS_STYLES[status],
      )}
    >
      {PROJECT_STATUS_LABELS[status]}
    </span>
  );
}

export function InitiativeStatusBadge({
  status,
}: {
  status: InitiativeStatus;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center whitespace-nowrap rounded-md border px-2 text-xs font-medium",
        INITIATIVE_STATUS_STYLES[status],
      )}
    >
      {INITIATIVE_STATUS_LABELS[status]}
    </span>
  );
}

export function HealthBadge({ health }: { health: ProjectHealth | null }) {
  if (!health) {
    return <span className="text-xs text-tertiary">暂无更新</span>;
  }

  const styles: Record<ProjectHealth, string> = {
    onTrack: "bg-[var(--success-soft)] text-success",
    atRisk: "bg-[var(--warning-soft)] text-warning",
    offTrack: "bg-[var(--danger-soft)] text-danger",
  };

  return (
    <span className={cn("inline-flex h-6 items-center rounded-md px-2 text-xs font-medium", styles[health])}>
      {HEALTH_LABELS[health]}
    </span>
  );
}

export function MemberAvatar({
  membership,
  size = "md",
}: {
  membership: Membership | undefined;
  size?: "sm" | "md";
}) {
  const dimensions = size === "sm" ? "h-6 w-6 text-[10px]" : "h-7 w-7 text-[11px]";
  const name = membership?.user.name ?? "未指派";

  return (
    <span
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-surface-subtle font-medium text-secondary",
        dimensions,
      )}
      aria-label={name}
    >
      {membership ? initials(membership.user.name) : "?"}
    </span>
  );
}

export function ProgressBar({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
}) {
  const safeValue = Math.min(100, Math.max(0, value));
  return (
    <div className={cn("min-w-0", className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(safeValue)}
        className="h-1.5 overflow-hidden rounded-full bg-surface-active"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${safeValue}%` }}
        />
      </div>
    </div>
  );
}

export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="min-w-0 border-l border-border pl-3 first:border-l-0 first:pl-0 sm:pl-4">
      <p className="truncate text-xs text-tertiary">{label}</p>
      <p className="mt-1 truncate font-mono text-lg font-medium tracking-tight text-primary">
        {value}
      </p>
      {detail ? <p className="mt-0.5 truncate text-xs text-secondary">{detail}</p> : null}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-8 items-center rounded-md border border-border bg-surface-subtle p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-[4px] px-2 text-xs transition-colors active:translate-y-px",
            option.value === value
              ? "bg-surface-raised text-primary shadow-[0_1px_2px_rgb(20_20_24_/_10%)]"
              : "text-secondary hover:bg-surface-hover hover:text-primary",
          )}
        >
          {option.icon}
          <span className="hidden sm:inline">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function EmptyPlanningState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-subtle text-tertiary">
        <Inbox size={17} strokeWidth={1.7} />
      </span>
      <h2 className="text-sm font-medium text-primary">{title}</h2>
      <p className="mt-1.5 text-sm leading-6 text-secondary">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function DateCell({ value }: { value: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-secondary">
      <CalendarDays size={13} strokeWidth={1.7} aria-hidden="true" />
      {formatPlanningDate(value)}
    </span>
  );
}

export interface TimelineMonth {
  key: string;
  label: string;
  timestamp: number;
}

function monthStart(value: string): number | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function addUtcMonths(timestamp: number, amount: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1);
}

export function buildTimelineMonths(
  values: readonly (string | null)[],
  maximum = 18,
): TimelineMonth[] {
  const parsed = values
    .filter((value): value is string => value !== null)
    .map(monthStart)
    .filter((value): value is number => value !== null);
  const fallbackStart = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
  const minimum = parsed.length > 0 ? Math.min(...parsed) : fallbackStart;
  const rawMaximum = parsed.length > 0 ? Math.max(...parsed) : addUtcMonths(minimum, 5);
  const months: TimelineMonth[] = [];

  for (let cursor = minimum; cursor <= rawMaximum && months.length < maximum; cursor = addUtcMonths(cursor, 1)) {
    const date = new Date(cursor);
    months.push({
      key: `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`,
      label: MONTH_FORMAT.format(date),
      timestamp: cursor,
    });
  }

  while (months.length < Math.min(6, maximum)) {
    const next = addUtcMonths(months.at(-1)?.timestamp ?? minimum, 1);
    const date = new Date(next);
    months.push({
      key: `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`,
      label: MONTH_FORMAT.format(date),
      timestamp: next,
    });
  }

  return months;
}

export function timelineColumn(
  value: string | null,
  months: readonly TimelineMonth[],
  fallback: number,
): number {
  if (!value || months.length === 0) return fallback;
  const parsed = monthStart(value);
  if (parsed === null) return fallback;
  const found = months.findIndex((month) => month.timestamp === parsed);
  if (found >= 0) return found + 1;
  return parsed < months[0].timestamp ? 1 : months.length;
}
