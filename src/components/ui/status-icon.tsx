import type { CSSProperties } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleDot,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type IssueStatusKind =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

const statusIcons: Record<IssueStatusKind, LucideIcon> = {
  triage: AlertCircle,
  backlog: CircleDashed,
  unstarted: Circle,
  started: CircleDot,
  completed: CheckCircle2,
  canceled: XCircle,
};

const statusClasses: Record<IssueStatusKind, string> = {
  triage: "text-warning",
  backlog: "text-tertiary",
  unstarted: "text-secondary",
  started: "text-warning",
  completed: "text-success",
  canceled: "text-tertiary",
};

const statusLabels: Record<IssueStatusKind, string> = {
  triage: "Triage",
  backlog: "Backlog",
  unstarted: "Unstarted",
  started: "Started",
  completed: "Completed",
  canceled: "Canceled",
};

export interface StatusIconProps {
  status: IssueStatusKind;
  size?: number;
  color?: string;
  label?: string;
  className?: string;
  strokeWidth?: number;
}

export function StatusIcon({
  status,
  size = 16,
  color,
  label = statusLabels[status],
  className,
  strokeWidth = 2,
}: StatusIconProps) {
  const Icon = statusIcons[status];
  const style: CSSProperties | undefined = color ? { color } : undefined;

  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-flex shrink-0 items-center justify-center", statusClasses[status], className)}
      style={style}
    >
      <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" />
    </span>
  );
}
