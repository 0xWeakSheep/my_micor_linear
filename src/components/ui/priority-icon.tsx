import {
  AlertTriangle,
  Minus,
  SignalHigh,
  SignalLow,
  SignalMedium,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type IssuePriority = "none" | "low" | "medium" | "high" | "urgent";

const priorityIcons: Record<IssuePriority, LucideIcon> = {
  none: Minus,
  low: SignalLow,
  medium: SignalMedium,
  high: SignalHigh,
  urgent: AlertTriangle,
};

const priorityClasses: Record<IssuePriority, string> = {
  none: "text-tertiary",
  low: "text-[var(--priority-low)]",
  medium: "text-[var(--priority-medium)]",
  high: "text-[var(--priority-high)]",
  urgent: "text-[var(--priority-urgent)]",
};

const priorityLabels: Record<IssuePriority, string> = {
  none: "No priority",
  low: "Low priority",
  medium: "Medium priority",
  high: "High priority",
  urgent: "Urgent priority",
};

export interface PriorityIconProps {
  priority: IssuePriority;
  size?: number;
  showLabel?: boolean;
  label?: string;
  className?: string;
  strokeWidth?: number;
}

export function PriorityIcon({
  priority,
  size = 16,
  showLabel = false,
  label = priorityLabels[priority],
  className,
  strokeWidth = 2,
}: PriorityIconProps) {
  const Icon = priorityIcons[priority];

  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5",
        priorityClasses[priority],
        className,
      )}
    >
      <Icon size={size} strokeWidth={strokeWidth} aria-hidden="true" />
      {showLabel ? <span className="text-xs text-secondary">{label}</span> : null}
    </span>
  );
}
