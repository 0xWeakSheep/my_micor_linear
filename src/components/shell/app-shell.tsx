"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AppHeader, type AppHeaderProps } from "@/components/shell/app-header";
import { DesktopSidebar } from "@/components/shell/desktop-sidebar";
import { MobileSidebar } from "@/components/shell/mobile-sidebar";
import type { AppSidebarProps } from "@/components/shell/sidebar";

export interface AppShellProps {
  sidebar: AppSidebarProps;
  header?: AppHeaderProps;
  children: ReactNode;
  details?: ReactNode;
  detailsOpen?: boolean;
  detailsAriaLabel?: string;
  sidebarCollapsed?: boolean;
  defaultSidebarCollapsed?: boolean;
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  mobileNavigationOpen?: boolean;
  defaultMobileNavigationOpen?: boolean;
  onMobileNavigationOpenChange?: (open: boolean) => void;
  contentId?: string;
  skipToContentLabel?: string;
  className?: string;
  mainClassName?: string;
  contentClassName?: string;
}

export function AppShell({
  sidebar,
  header,
  children,
  details,
  detailsOpen = Boolean(details),
  detailsAriaLabel = "Details panel",
  sidebarCollapsed: controlledSidebarCollapsed,
  defaultSidebarCollapsed = false,
  onSidebarCollapsedChange,
  mobileNavigationOpen: controlledMobileOpen,
  defaultMobileNavigationOpen = false,
  onMobileNavigationOpenChange,
  contentId = "main-content",
  skipToContentLabel = "Skip to main content",
  className,
  mainClassName,
  contentClassName,
}: AppShellProps) {
  const [internalSidebarCollapsed, setInternalSidebarCollapsed] = useState(
    defaultSidebarCollapsed,
  );
  const [internalMobileOpen, setInternalMobileOpen] = useState(
    defaultMobileNavigationOpen,
  );
  const sidebarCollapsed = controlledSidebarCollapsed ?? internalSidebarCollapsed;
  const mobileOpen = controlledMobileOpen ?? internalMobileOpen;

  const setSidebarCollapsed = (collapsed: boolean) => {
    if (controlledSidebarCollapsed === undefined) setInternalSidebarCollapsed(collapsed);
    onSidebarCollapsedChange?.(collapsed);
  };

  const setMobileOpen = (open: boolean) => {
    if (controlledMobileOpen === undefined) setInternalMobileOpen(open);
    onMobileNavigationOpenChange?.(open);
  };

  return (
    <div
      className={cn(
        "relative flex h-[100dvh] min-h-0 w-full overflow-hidden bg-background text-primary",
        className,
      )}
    >
      <a
        href={`#${contentId}`}
        className="fixed left-3 top-3 z-[70] -translate-y-16 rounded-md bg-accent px-3 py-2 text-sm font-medium text-[var(--accent-contrast)] shadow-[var(--shadow-popover)] transition-transform focus:translate-y-0"
      >
        {skipToContentLabel}
      </a>

      <DesktopSidebar {...sidebar} collapsed={sidebarCollapsed} />
      <MobileSidebar
        {...sidebar}
        open={mobileOpen}
        onOpenChange={setMobileOpen}
      />

      <div className={cn("flex min-w-0 flex-1 flex-col", mainClassName)}>
        <AppHeader
          {...header}
          onOpenMobileNavigation={() => setMobileOpen(true)}
          onToggleDesktopNavigation={() => setSidebarCollapsed(!sidebarCollapsed)}
          desktopNavigationCollapsed={sidebarCollapsed}
        />
        <main
          id={contentId}
          tabIndex={-1}
          className={cn(
            "min-h-0 flex-1 overflow-auto bg-background outline-none",
            contentClassName,
          )}
        >
          {children}
        </main>
      </div>

      {details && detailsOpen ? (
        <aside
          aria-label={detailsAriaLabel}
          className="hidden h-full w-[var(--details-width)] shrink-0 overflow-auto border-l border-border bg-panel lg:block"
        >
          {details}
        </aside>
      ) : null}
    </div>
  );
}
