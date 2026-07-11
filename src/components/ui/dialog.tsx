"use client";

import type { ComponentProps } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-40 bg-[var(--overlay)] backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

const dialogContentVariants = cva(
  "fixed z-50 border-border-strong bg-surface-raised text-primary shadow-[var(--shadow-dialog)] outline-none",
  {
    variants: {
      variant: {
        dialog:
          "left-1/2 top-1/2 max-h-[min(86dvh,760px)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        "drawer-left":
          "inset-y-0 left-0 h-[100dvh] w-[min(88vw,320px)] border-r data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
        "drawer-right":
          "inset-y-0 right-0 h-[100dvh] w-[min(88vw,360px)] border-l data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
      },
      size: {
        sm: "max-w-sm",
        md: "max-w-lg",
        lg: "max-w-2xl",
        xl: "max-w-4xl",
        full: "max-w-[calc(100%-2rem)]",
      },
    },
    defaultVariants: {
      variant: "dialog",
      size: "md",
    },
  },
);

export interface DialogContentProps
  extends ComponentProps<typeof DialogPrimitive.Content>,
    VariantProps<typeof dialogContentVariants> {
  showClose?: boolean;
}

export function DialogContent({
  className,
  children,
  variant,
  size,
  showClose = true,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(dialogContentVariants({ variant, size }), className)}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            className="absolute right-3 top-3 inline-flex size-7 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Close dialog"
          >
            <X className="size-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  className,
  ...props
}: ComponentProps<"div">) {
  return <div className={cn("space-y-1.5 px-5 pb-3 pt-5", className)} {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-base font-semibold leading-5 text-primary", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm leading-5 text-secondary", className)}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}
