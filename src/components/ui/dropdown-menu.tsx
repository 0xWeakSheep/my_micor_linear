"use client";

import type { ComponentProps, ReactNode } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export type DropdownMenuContentProps = ComponentProps<
  typeof DropdownMenuPrimitive.Content
>;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = "start",
  ...props
}: DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "z-50 min-w-48 overflow-hidden rounded-lg border border-border-strong bg-surface-raised p-1 text-sm text-primary shadow-[var(--shadow-popover)] will-change-[transform,opacity] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export interface DropdownMenuItemProps
  extends ComponentProps<typeof DropdownMenuPrimitive.Item> {
  icon?: ReactNode;
  shortcut?: string;
  destructive?: boolean;
  inset?: boolean;
}

export function DropdownMenuItem({
  className,
  icon,
  shortcut,
  destructive = false,
  inset = false,
  children,
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "relative flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-sm outline-none transition-colors duration-100 data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-45",
        destructive &&
          "text-danger data-[highlighted]:bg-[var(--danger-soft)] data-[highlighted]:text-danger",
        inset && "pl-8",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="inline-flex size-4 shrink-0 items-center justify-center text-tertiary" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? (
        <kbd className="ml-auto pl-4 font-sans text-[10px] tracking-wide text-tertiary">
          {shortcut}
        </kbd>
      ) : null}
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        "px-2 py-1.5 text-[11px] font-medium text-tertiary",
        inset && "pl-8",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(
        "relative flex h-8 cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none transition-colors duration-100 data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-3.5" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        "relative flex h-8 cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none transition-colors duration-100 data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle className="size-2 fill-current" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        "flex h-8 cursor-default select-none items-center rounded-md px-2 text-sm outline-none transition-colors duration-100 data-[state=open]:bg-surface-hover data-[highlighted]:bg-surface-hover",
        inset && "pl-8",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronRight className="ml-2 size-3.5 text-tertiary" aria-hidden="true" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      className={cn(
        "z-50 min-w-44 overflow-hidden rounded-lg border border-border-strong bg-surface-raised p-1 text-primary shadow-[var(--shadow-popover)]",
        className,
      )}
      {...props}
    />
  );
}
