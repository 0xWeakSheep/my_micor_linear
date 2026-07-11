"use client";

import type { ComponentProps } from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn, initials } from "@/lib/utils";

export type AvatarSize = "xs" | "sm" | "md" | "lg";
export type AvatarPresence = "online" | "away" | "offline" | "busy";

const sizeClasses: Record<AvatarSize, string> = {
  xs: "size-5 text-[8px]",
  sm: "size-6 text-[9px]",
  md: "size-7 text-[10px]",
  lg: "size-9 text-xs",
};

const presenceClasses: Record<AvatarPresence, string> = {
  online: "bg-success",
  away: "bg-warning",
  offline: "bg-tertiary",
  busy: "bg-danger",
};

const presenceLabels: Record<AvatarPresence, string> = {
  online: "Online",
  away: "Away",
  offline: "Offline",
  busy: "Busy",
};

export interface AvatarProps
  extends Omit<ComponentProps<typeof AvatarPrimitive.Root>, "children"> {
  name: string;
  src?: string | null;
  alt?: string;
  size?: AvatarSize;
  status?: AvatarPresence;
  fallbackDelayMs?: number;
}

export function Avatar({
  name,
  src,
  alt = name,
  size = "md",
  status,
  fallbackDelayMs = 0,
  className,
  ...props
}: AvatarProps) {
  return (
    <span className="relative inline-flex shrink-0">
      <AvatarPrimitive.Root
        className={cn(
          "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-[color-mix(in_srgb,var(--border-strong)_72%,transparent)] bg-surface-active font-medium text-secondary",
          sizeClasses[size],
          className,
        )}
        {...props}
      >
        {src ? (
          <AvatarPrimitive.Image
            src={src}
            alt={alt}
            className="size-full object-cover"
          />
        ) : null}
        <AvatarPrimitive.Fallback
          delayMs={fallbackDelayMs}
          className="flex size-full items-center justify-center bg-accent-soft text-accent"
          aria-label={alt}
        >
          {initials(name)}
        </AvatarPrimitive.Fallback>
      </AvatarPrimitive.Root>
      {status ? (
        <span
          role="img"
          aria-label={presenceLabels[status]}
          className={cn(
            "absolute bottom-0 right-0 size-[28%] min-h-1.5 min-w-1.5 rounded-full ring-2 ring-[var(--surface)]",
            presenceClasses[status],
          )}
        />
      ) : null}
    </span>
  );
}
