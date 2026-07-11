"use client";

import {
  Ban,
  Check,
  Circle,
  CircleDashed,
  CircleDotDashed,
  Minus,
  SignalHigh,
  SignalLow,
  SignalMedium,
} from "lucide-react";
import type { Issue, User, WorkflowState } from "@/lib/domain";
import { cn, initials } from "@/lib/utils";

export function StateIcon({
  state,
  size = 15,
  className,
}: {
  state: Pick<WorkflowState, "type" | "color"> | undefined;
  size?: number;
  className?: string;
}) {
  const style = { color: state?.color ?? "var(--text-tertiary)" };
  const common = { size, strokeWidth: 2, className, style, "aria-hidden": true } as const;

  switch (state?.type) {
    case "completed":
      return (
        <span
          className={cn("grid shrink-0 place-items-center rounded-full text-white", className)}
          style={{ width: size, height: size, background: state.color }}
          aria-hidden="true"
        >
          <Check size={Math.max(9, size - 5)} strokeWidth={2.8} />
        </span>
      );
    case "canceled":
      return <Ban {...common} />;
    case "started":
      return <CircleDotDashed {...common} />;
    case "backlog":
      return <CircleDashed {...common} />;
    case "triage":
      return <SignalMedium {...common} />;
    default:
      return <Circle {...common} />;
  }
}

export function PriorityIcon({
  priority,
  size = 15,
  className,
}: {
  priority: Issue["priority"];
  size?: number;
  className?: string;
}) {
  const props = { size, strokeWidth: 2, className, "aria-hidden": true } as const;
  switch (priority) {
    case 1:
      return <SignalHigh {...props} style={{ color: "var(--priority-urgent)" }} />;
    case 2:
      return <SignalHigh {...props} style={{ color: "var(--priority-high)" }} />;
    case 3:
      return <SignalMedium {...props} style={{ color: "var(--priority-medium)" }} />;
    case 4:
      return <SignalLow {...props} style={{ color: "var(--priority-low)" }} />;
    default:
      return <Minus {...props} className={cn("text-tertiary", className)} />;
  }
}

export function UserAvatar({
  user,
  size = 22,
  className,
}: {
  user: Pick<User, "name" | "avatarUrl"> | undefined;
  size?: number;
  className?: string;
}) {
  const name = user?.name ?? "未分配";
  const hue = name.split("").reduce((total, character) => total + character.charCodeAt(0), 0) % 360;

  if (user?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote user URLs are not known at build time.
      <img
        src={user.avatarUrl}
        alt={name}
        width={size}
        height={size}
        className={cn("shrink-0 rounded-full object-cover ring-1 ring-border", className)}
      />
    );
  }

  return (
    <span
      aria-label={name}
      className={cn(
        "grid shrink-0 select-none place-items-center rounded-full text-[9px] font-semibold text-white ring-1 ring-black/10 dark:ring-white/10",
        !user && "bg-surface-active text-tertiary",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: user ? `hsl(${hue} 44% 48%)` : undefined,
      }}
    >
      {user ? initials(name) : "–"}
    </span>
  );
}
