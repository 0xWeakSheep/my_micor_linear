"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Menu, PanelLeft, PanelLeftClose } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type {
  ShellAction,
  ShellBreadcrumb,
  ShellTab,
} from "@/components/shell/types";

export interface AppHeaderProps {
  breadcrumbs?: ShellBreadcrumb[];
  tabs?: ShellTab[];
  actions?: ShellAction[];
  leading?: ReactNode;
  trailing?: ReactNode;
  onOpenMobileNavigation?: () => void;
  onToggleDesktopNavigation?: () => void;
  desktopNavigationCollapsed?: boolean;
  showNavigationControls?: boolean;
  className?: string;
  ariaLabel?: string;
}

function handleNavigation(
  event: MouseEvent<HTMLElement>,
  disabled: boolean | undefined,
  onSelect: (() => void) | undefined,
) {
  if (disabled) {
    event.preventDefault();
    return;
  }
  onSelect?.();
}

function HeaderAction({ action }: { action: ShellAction }) {
  const Icon = action.icon;
  const className = cn(
    "relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-tertiary transition-colors duration-100 hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
    action.active && "bg-surface-active text-primary",
    action.disabled && "pointer-events-none opacity-45",
  );
  const content = (
    <>
      <Icon className="size-4" strokeWidth={1.8} aria-hidden="true" />
      {action.badge !== undefined ? (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[8px] font-semibold leading-3.5 text-[var(--accent-contrast)]">
          {action.badge}
        </span>
      ) : null}
    </>
  );

  const element = action.href ? (
    <Link
      href={action.href}
      className={className}
      aria-label={action.label}
      aria-disabled={action.disabled || undefined}
      tabIndex={action.disabled ? -1 : undefined}
      onClick={(event) => handleNavigation(event, action.disabled, action.onSelect)}
    >
      {content}
    </Link>
  ) : (
    <button
      type="button"
      className={className}
      disabled={action.disabled}
      aria-label={action.label}
      onClick={(event) => handleNavigation(event, action.disabled, action.onSelect)}
    >
      {content}
    </button>
  );

  return (
    <Tooltip
      content={
        <span className="flex items-center gap-3">
          <span>{action.label}</span>
          {action.shortcut ? (
            <kbd className="font-sans text-[10px] text-tertiary">{action.shortcut}</kbd>
          ) : null}
        </span>
      }
      side="bottom"
    >
      {element}
    </Tooltip>
  );
}

function BreadcrumbItem({
  item,
  isLast,
}: {
  item: ShellBreadcrumb;
  isLast: boolean;
}) {
  const Icon = item.icon;
  const className = cn(
    "flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[13px] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
    isLast || item.current
      ? "font-medium text-primary"
      : "text-tertiary hover:bg-surface-hover hover:text-secondary",
  );
  const content = (
    <>
      {Icon ? <Icon className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" /> : null}
      <span className="truncate">{item.label}</span>
    </>
  );

  return item.href ? (
    <Link
      href={item.href}
      className={className}
      aria-current={isLast || item.current ? "page" : undefined}
      onClick={item.onSelect}
    >
      {content}
    </Link>
  ) : item.onSelect ? (
    <button type="button" className={className} onClick={item.onSelect}>
      {content}
    </button>
  ) : (
    <span className={className} aria-current={isLast || item.current ? "page" : undefined}>
      {content}
    </span>
  );
}

function HeaderTab({ tab }: { tab: ShellTab }) {
  const Icon = tab.icon;
  const className = cn(
    "relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
    tab.active
      ? "bg-surface-active text-primary"
      : "text-tertiary hover:bg-surface-hover hover:text-secondary",
    tab.disabled && "pointer-events-none opacity-45",
  );
  const content = (
    <>
      {Icon ? <Icon className="size-3.5" strokeWidth={1.8} aria-hidden="true" /> : null}
      <span>{tab.label}</span>
      {tab.count !== undefined ? (
        <span className="text-[10px] tabular-nums text-tertiary">{tab.count}</span>
      ) : null}
    </>
  );

  return tab.href ? (
    <Link
      href={tab.href}
      className={className}
      aria-current={tab.active ? "page" : undefined}
      aria-disabled={tab.disabled || undefined}
      tabIndex={tab.disabled ? -1 : undefined}
      onClick={(event) => handleNavigation(event, tab.disabled, tab.onSelect)}
    >
      {content}
    </Link>
  ) : (
    <button
      type="button"
      className={className}
      disabled={tab.disabled}
      aria-pressed={tab.active}
      onClick={(event) => handleNavigation(event, tab.disabled, tab.onSelect)}
    >
      {content}
    </button>
  );
}

export function AppHeader({
  breadcrumbs = [],
  tabs = [],
  actions = [],
  leading,
  trailing,
  onOpenMobileNavigation,
  onToggleDesktopNavigation,
  desktopNavigationCollapsed = false,
  showNavigationControls = true,
  className,
  ariaLabel = "Workspace header",
}: AppHeaderProps) {
  return (
    <header
      aria-label={ariaLabel}
      className={cn(
        "app-drag-region flex h-[var(--header-height)] min-w-0 shrink-0 items-center gap-2 border-b border-border bg-background px-2.5 sm:px-3",
        className,
      )}
    >
      {showNavigationControls && onOpenMobileNavigation ? (
        <IconButton
          label="Open navigation"
          tooltip="Open navigation"
          icon={<Menu className="size-4" />}
          variant="ghost"
          size="icon-sm"
          className="app-no-drag md:hidden"
          onClick={onOpenMobileNavigation}
        />
      ) : null}
      {showNavigationControls && onToggleDesktopNavigation ? (
        <IconButton
          label={desktopNavigationCollapsed ? "Expand navigation" : "Collapse navigation"}
          tooltip={desktopNavigationCollapsed ? "Expand navigation" : "Collapse navigation"}
          icon={
            desktopNavigationCollapsed ? (
              <PanelLeft className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )
          }
          variant="ghost"
          size="icon-sm"
          className="app-no-drag hidden md:inline-flex"
          onClick={onToggleDesktopNavigation}
        />
      ) : null}

      {leading ? <div className="app-no-drag flex shrink-0 items-center">{leading}</div> : null}

      {breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="app-no-drag min-w-0">
          <ol className="flex min-w-0 items-center">
            {breadcrumbs.map((item, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <li
                  key={item.id}
                  className={cn(
                    "min-w-0 items-center",
                    isLast ? "flex" : "hidden sm:flex",
                  )}
                >
                  <BreadcrumbItem item={item} isLast={isLast} />
                  {!isLast ? (
                    <ChevronRight className="mx-0.5 size-3 shrink-0 text-tertiary" aria-hidden="true" />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      {tabs.length > 0 ? (
        <>
          <span className="mx-0.5 hidden h-5 w-px shrink-0 bg-border sm:block" aria-hidden="true" />
          <nav
            aria-label="View tabs"
            className="app-no-drag min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div className="flex min-w-max items-center gap-0.5">
              {tabs.map((tab) => (
                <HeaderTab key={tab.id} tab={tab} />
              ))}
            </div>
          </nav>
        </>
      ) : (
        <div className="flex-1" />
      )}

      <div className="app-no-drag ml-auto flex shrink-0 items-center gap-0.5">
        {actions.map((action) => (
          <HeaderAction key={action.id} action={action} />
        ))}
        {trailing}
      </div>
    </header>
  );
}
