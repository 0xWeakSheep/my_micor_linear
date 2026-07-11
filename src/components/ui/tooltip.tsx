"use client";

import type { ComponentProps, ReactElement, ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export type TooltipContentProps = ComponentProps<typeof TooltipPrimitive.Content>;

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-64 rounded-md border border-border-strong bg-surface-raised px-2 py-1.5 text-xs leading-4 text-primary shadow-[var(--shadow-popover)] will-change-[transform,opacity] data-[state=closed]:animate-out data-[state=delayed-open]:animate-in data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export interface TooltipProps {
  children: ReactElement;
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delayDuration?: number;
  disabled?: boolean;
  contentClassName?: string;
}

export function Tooltip({
  children,
  content,
  side = "top",
  align = "center",
  delayDuration = 350,
  disabled = false,
  contentClassName,
}: TooltipProps) {
  if (disabled) return children;

  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipContent side={side} align={align} className={contentClassName}>
          {content}
        </TooltipContent>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
