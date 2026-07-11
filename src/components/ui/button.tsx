"use client";

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { LoaderCircle } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:translate-y-px",
  {
    variants: {
      variant: {
        primary:
          "border border-transparent bg-accent text-[var(--accent-contrast)] hover:bg-accent-hover",
        secondary:
          "border border-border bg-surface-raised text-primary hover:border-border-strong hover:bg-surface-hover",
        subtle:
          "border border-transparent bg-surface-subtle text-primary hover:bg-surface-hover",
        ghost:
          "border border-transparent bg-transparent text-secondary hover:bg-surface-hover hover:text-primary",
        danger:
          "border border-transparent bg-[var(--danger)] text-white hover:brightness-95",
        outline:
          "border border-border bg-transparent text-secondary hover:border-border-strong hover:bg-surface-hover hover:text-primary",
      },
      size: {
        xs: "h-6 px-2 text-[11px]",
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3 text-sm",
        lg: "h-9 px-3.5 text-sm",
        "icon-xs": "size-6 p-0",
        "icon-sm": "size-7 p-0",
        "icon-md": "size-8 p-0",
        "icon-lg": "size-9 p-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  loadingLabel?: string;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant,
      size,
      loading = false,
      loadingLabel,
      startIcon,
      endIcon,
      disabled,
      children,
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          startIcon
        )}
        {loading && loadingLabel ? loadingLabel : children}
        {!loading ? endIcon : null}
      </button>
    );
  },
);

export interface IconButtonProps
  extends Omit<ButtonProps, "children" | "aria-label"> {
  label: string;
  icon: ReactNode;
  tooltip?: string;
  tooltipSide?: "top" | "right" | "bottom" | "left";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      icon,
      tooltip,
      tooltipSide = "bottom",
      size = "icon-md",
      ...props
    },
    ref,
  ) {
    const button = (
      <Button ref={ref} size={size} aria-label={label} {...props}>
        <span className="inline-flex" aria-hidden="true">
          {icon}
        </span>
      </Button>
    );

    return tooltip ? (
      <Tooltip content={tooltip} side={tooltipSide}>
        {button}
      </Tooltip>
    ) : (
      button
    );
  },
);
