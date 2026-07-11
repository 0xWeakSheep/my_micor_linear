import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-[var(--radius-sm)] border font-medium leading-none",
  {
    variants: {
      variant: {
        neutral: "border-transparent bg-surface-subtle text-secondary",
        accent: "border-transparent bg-accent-soft text-accent",
        success: "border-transparent bg-[var(--success-soft)] text-success",
        warning: "border-transparent bg-[var(--warning-soft)] text-warning",
        danger: "border-transparent bg-[var(--danger-soft)] text-danger",
        info: "border-transparent bg-[var(--info-soft)] text-[var(--info)]",
        outline: "border-border bg-transparent text-secondary",
      },
      size: {
        xs: "h-5 px-1.5 text-[10px]",
        sm: "h-6 px-2 text-[11px]",
        md: "h-7 px-2.5 text-xs",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "sm",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  icon?: ReactNode;
}

export function Badge({
  className,
  variant,
  size,
  icon,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {icon ? <span className="inline-flex shrink-0" aria-hidden="true">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
