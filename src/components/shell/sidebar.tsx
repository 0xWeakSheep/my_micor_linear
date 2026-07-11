"use client";

import { useId, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Ellipsis,
  LockKeyhole,
  Plus,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import type {
  ShellAction,
  SidebarNavigationItem,
  SidebarSection,
  SidebarTeam,
  WorkspaceOption,
} from "@/components/shell/types";

export interface AppSidebarProps {
  workspace: WorkspaceOption;
  workspaces?: WorkspaceOption[];
  sections: SidebarSection[];
  teams?: SidebarTeam[];
  searchAction?: Omit<ShellAction, "id" | "icon">;
  createAction?: Omit<ShellAction, "id" | "icon">;
  onWorkspaceSelect?: (workspace: WorkspaceOption) => void;
  workspaceSettingsHref?: string;
  onOpenWorkspaceSettings?: () => void;
  footer?: ReactNode;
  collapsed?: boolean;
  onNavigate?: () => void;
  className?: string;
  ariaLabel?: string;
}

const badgeToneClasses = {
  neutral: "bg-surface-active text-secondary",
  accent: "bg-accent-soft text-accent",
  danger: "bg-[var(--danger-soft)] text-danger",
} as const;

function activateItem(
  event: MouseEvent<HTMLElement>,
  item: SidebarNavigationItem,
  onNavigate?: () => void,
) {
  if (item.disabled) {
    event.preventDefault();
    return;
  }
  item.onSelect?.();
  onNavigate?.();
}

function NavigationItem({
  item,
  collapsed,
  depth = 0,
  onNavigate,
}: {
  item: SidebarNavigationItem;
  collapsed: boolean;
  depth?: number;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const content = (
    <>
      <Icon
        className={cn("size-4 shrink-0", item.active ? "text-primary" : "text-tertiary")}
        strokeWidth={1.8}
        aria-hidden="true"
      />
      {!collapsed ? (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.badge !== undefined ? (
            <span
              className={cn(
                "inline-flex min-w-5 items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-4",
                badgeToneClasses[item.badgeTone ?? "neutral"],
              )}
            >
              {item.badge}
            </span>
          ) : null}
          {item.shortcut ? (
            <kbd className="font-sans text-[10px] tracking-wide text-tertiary">
              {item.shortcut}
            </kbd>
          ) : null}
        </>
      ) : null}
    </>
  );

  const className = cn(
    "group relative flex h-8 w-full min-w-0 items-center rounded-md text-[13px] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
    collapsed ? "justify-center px-0" : "gap-2 px-2 text-left",
    depth > 0 && !collapsed ? "pl-8" : null,
    item.active
      ? "bg-surface-active font-medium text-primary"
      : "text-secondary hover:bg-surface-hover hover:text-primary",
    item.disabled && "cursor-not-allowed opacity-45",
  );

  const element = item.href ? (
    <Link
      href={item.href}
      className={className}
      aria-current={item.active ? "page" : undefined}
      aria-disabled={item.disabled || undefined}
      tabIndex={item.disabled ? -1 : undefined}
      onClick={(event) => activateItem(event, item, onNavigate)}
    >
      {content}
    </Link>
  ) : (
    <button
      type="button"
      className={className}
      disabled={item.disabled}
      aria-current={item.active ? "page" : undefined}
      onClick={(event) => activateItem(event, item, onNavigate)}
    >
      {content}
    </button>
  );

  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {element}
    </Tooltip>
  ) : (
    element
  );
}

function SectionBlock({
  section,
  collapsed,
  onNavigate,
}: {
  section: SidebarSection;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const [expanded, setExpanded] = useState(section.defaultExpanded !== false);
  const contentId = useId();
  const collapsible = section.collapsible !== false && Boolean(section.label);

  return (
    <section className={cn("mt-3", collapsed && "mt-2")} aria-label={section.label}>
      {section.label && !collapsed ? (
        <div className="mb-1 flex h-7 items-center px-2">
          {collapsible ? (
            <button
              type="button"
              className="group flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left text-[11px] font-medium text-tertiary transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-expanded={expanded}
              aria-controls={contentId}
              onClick={() => setExpanded((value) => !value)}
            >
              <ChevronRight
                className={cn("size-3 transition-transform duration-150", expanded && "rotate-90")}
                aria-hidden="true"
              />
              <span className="truncate">{section.label}</span>
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-tertiary">
              {section.label}
            </span>
          )}
          {section.action ? (
            <IconButton
              label={section.action.label}
              tooltip={section.action.label}
              icon={<section.action.icon className="size-3.5" />}
              size="icon-xs"
              variant="ghost"
              disabled={section.action.disabled}
              onClick={section.action.onSelect}
            />
          ) : null}
        </div>
      ) : null}
      <div
        id={contentId}
        hidden={!expanded && collapsible}
        className="space-y-0.5"
      >
        {section.items.map((item) => (
          <div key={item.id}>
            <NavigationItem item={item} collapsed={collapsed} onNavigate={onNavigate} />
            {item.items && !collapsed ? (
              <div className="ml-4 border-l border-border pl-1">
                {item.items.map((child) => (
                  <NavigationItem
                    key={child.id}
                    item={child}
                    collapsed={false}
                    depth={1}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function TeamBlock({
  team,
  collapsed,
  onNavigate,
}: {
  team: SidebarTeam;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const [expanded, setExpanded] = useState(team.defaultExpanded !== false);
  const contentId = useId();
  const TeamIcon = team.icon;
  const iconStyle: CSSProperties | undefined = team.color ? { color: team.color } : undefined;

  const label = (
    <>
      <span
        className="flex size-5 shrink-0 items-center justify-center rounded-[5px] border border-border bg-surface-subtle text-[9px] font-semibold text-secondary"
        style={iconStyle}
        aria-hidden="true"
      >
        {TeamIcon ? <TeamIcon className="size-3.5" strokeWidth={1.8} /> : team.name.slice(0, 1).toUpperCase()}
      </span>
      {!collapsed ? (
        <>
          <span className="min-w-0 flex-1 truncate">{team.name}</span>
          {team.private ? (
            <LockKeyhole className="size-3 text-tertiary" aria-label="Private team" />
          ) : null}
          <ChevronRight
            className={cn("size-3.5 text-tertiary transition-transform duration-150", expanded && "rotate-90")}
            aria-hidden="true"
          />
        </>
      ) : null}
    </>
  );

  const className = cn(
    "flex h-8 w-full min-w-0 items-center rounded-md text-[13px] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
    collapsed ? "justify-center" : "gap-2 px-2 text-left",
    team.active
      ? "bg-surface-active font-medium text-primary"
      : "text-secondary hover:bg-surface-hover hover:text-primary",
  );

  const teamButton = team.href ? (
    <Link
      href={team.href}
      className={className}
      aria-current={team.active ? "page" : undefined}
      onClick={(event) => {
        team.onSelect?.();
        onNavigate?.();
        if (!collapsed && team.items.length > 0 && event.detail === 0) setExpanded(true);
      }}
    >
      {label}
    </Link>
  ) : (
    <button
      type="button"
      className={className}
      aria-expanded={!collapsed ? expanded : undefined}
      aria-controls={!collapsed ? contentId : undefined}
      onClick={() => {
        team.onSelect?.();
        if (collapsed) onNavigate?.();
        else setExpanded((value) => !value);
      }}
    >
      {label}
    </button>
  );

  return (
    <div>
      {collapsed ? (
        <Tooltip content={team.name} side="right">
          {teamButton}
        </Tooltip>
      ) : (
        teamButton
      )}
      {!collapsed ? (
        <div id={contentId} hidden={!expanded} className="ml-4 border-l border-border pl-1">
          {team.items.map((item) => (
            <NavigationItem
              key={item.id}
              item={item}
              collapsed={false}
              depth={1}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AppSidebar({
  workspace,
  workspaces,
  sections,
  teams = [],
  searchAction,
  createAction,
  onWorkspaceSelect,
  workspaceSettingsHref,
  onOpenWorkspaceSettings,
  footer,
  collapsed = false,
  onNavigate,
  className,
  ariaLabel = "Workspace navigation",
}: AppSidebarProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col bg-sidebar text-primary",
        className,
      )}
    >
      <div
        className={cn(
          "app-drag-region flex h-[var(--header-height)] shrink-0 items-center border-b border-transparent",
          collapsed ? "justify-center px-2" : "gap-1 px-2.5",
        )}
      >
        <div className={cn("app-no-drag min-w-0", collapsed ? "w-8" : "flex-1") }>
          <WorkspaceSwitcher
            current={workspace}
            workspaces={workspaces}
            collapsed={collapsed}
            onSelect={onWorkspaceSelect}
            settingsHref={workspaceSettingsHref}
            onOpenSettings={onOpenWorkspaceSettings}
          />
        </div>
        {!collapsed && searchAction ? (
          <IconButton
            label={searchAction.label}
            tooltip={searchAction.label}
            icon={<Search className="size-4" strokeWidth={1.8} />}
            variant="ghost"
            size="icon-md"
            disabled={searchAction.disabled}
            onClick={searchAction.onSelect}
          />
        ) : null}
        {!collapsed && createAction ? (
          <IconButton
            label={createAction.label}
            tooltip={createAction.label}
            icon={<Plus className="size-4" strokeWidth={1.9} />}
            variant="subtle"
            size="icon-md"
            disabled={createAction.disabled}
            onClick={createAction.onSelect}
          />
        ) : null}
      </div>

      {collapsed && (searchAction || createAction) ? (
        <div className="flex shrink-0 flex-col items-center gap-1 px-2 pb-1 pt-2">
          {searchAction ? (
            <IconButton
              label={searchAction.label}
              tooltip={searchAction.label}
              tooltipSide="right"
              icon={<Search className="size-4" strokeWidth={1.8} />}
              variant="ghost"
              size="icon-md"
              disabled={searchAction.disabled}
              onClick={searchAction.onSelect}
            />
          ) : null}
          {createAction ? (
            <IconButton
              label={createAction.label}
              tooltip={createAction.label}
              tooltipSide="right"
              icon={<Plus className="size-4" strokeWidth={1.9} />}
              variant="subtle"
              size="icon-md"
              disabled={createAction.disabled}
              onClick={createAction.onSelect}
            />
          ) : null}
        </div>
      ) : null}

      <nav
        aria-label={ariaLabel}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-3",
          collapsed ? "px-2" : "px-2.5",
        )}
      >
        {sections.map((section) => (
          <SectionBlock
            key={section.id}
            section={section}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}

        {teams.length > 0 ? (
          <section className={cn("mt-4", collapsed && "mt-2")} aria-label="Your teams">
            {!collapsed ? (
              <div className="mb-1 flex h-7 items-center px-2 text-[11px] font-medium text-tertiary">
                <span className="min-w-0 flex-1 truncate">Your teams</span>
                <Tooltip content="Team options" side="right">
                  <button
                    type="button"
                    className="inline-flex size-6 items-center justify-center rounded-md transition-colors hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    aria-label="Team options"
                  >
                    <Ellipsis className="size-3.5" aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
            ) : null}
            <div className="space-y-0.5">
              {teams.map((team) => (
                <TeamBlock
                  key={team.id}
                  team={team}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </section>
        ) : null}
      </nav>

      {footer ? (
        <div className={cn("shrink-0 border-t border-border", collapsed ? "p-2" : "p-2.5")}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}
