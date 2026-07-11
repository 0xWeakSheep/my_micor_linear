"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronDown, LockKeyhole, Settings } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import type { WorkspaceOption } from "@/components/shell/types";

export interface WorkspaceSwitcherProps {
  current: WorkspaceOption;
  workspaces?: WorkspaceOption[];
  collapsed?: boolean;
  onSelect?: (workspace: WorkspaceOption) => void;
  settingsHref?: string;
  onOpenSettings?: () => void;
  menuFooter?: ReactNode;
  className?: string;
}

function WorkspaceMark({ workspace }: { workspace: WorkspaceOption }) {
  if (workspace.logo) {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md">
        {workspace.logo}
      </span>
    );
  }

  const hue = Math.abs(
    Array.from(workspace.name).reduce((total, character) => total + character.charCodeAt(0), 0) %
      360,
  );
  const style = {
    "--workspace-hue": hue,
  } as CSSProperties;

  return (
    <span
      style={style}
      className="flex size-6 shrink-0 items-center justify-center rounded-md border border-[hsl(var(--workspace-hue)_45%_44%/35%)] bg-[hsl(var(--workspace-hue)_50%_45%/16%)] text-[9px] font-semibold text-[hsl(var(--workspace-hue)_58%_62%)]"
      aria-hidden="true"
    >
      {initials(workspace.name).slice(0, 1)}
    </span>
  );
}

function WorkspaceMenuItem({
  workspace,
  onSelect,
}: {
  workspace: WorkspaceOption;
  onSelect?: (workspace: WorkspaceOption) => void;
}) {
  const content = (
    <>
      <WorkspaceMark workspace={workspace} />
      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
      {workspace.private ? (
        <LockKeyhole className="size-3 text-tertiary" aria-label="Private workspace" />
      ) : null}
      {workspace.active ? (
        <Check className="size-3.5 text-accent" aria-label="Current workspace" />
      ) : null}
    </>
  );

  if (workspace.href) {
    return (
      <DropdownMenuItem asChild onSelect={() => onSelect?.(workspace)}>
        <Link href={workspace.href}>{content}</Link>
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem onSelect={() => onSelect?.(workspace)}>{content}</DropdownMenuItem>
  );
}

export function WorkspaceSwitcher({
  current,
  workspaces = [current],
  collapsed = false,
  onSelect,
  settingsHref,
  onOpenSettings,
  menuFooter,
  className,
}: WorkspaceSwitcherProps) {
  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className={cn(
          "flex h-8 min-w-0 items-center rounded-md text-left text-primary transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          collapsed ? "w-8 justify-center" : "w-full gap-2 px-1.5",
          className,
        )}
        aria-label={collapsed ? `Switch workspace, current workspace ${current.name}` : undefined}
      >
        <WorkspaceMark workspace={current} />
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
              {current.name}
            </span>
            {current.private ? (
              <LockKeyhole className="size-3 text-tertiary" aria-label="Private workspace" />
            ) : null}
            <ChevronDown className="size-3.5 shrink-0 text-tertiary" aria-hidden="true" />
          </>
        ) : null}
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {collapsed ? (
        <Tooltip content={current.name} side="right">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((workspace) => (
          <WorkspaceMenuItem key={workspace.id} workspace={workspace} onSelect={onSelect} />
        ))}
        {settingsHref || onOpenSettings || menuFooter ? <DropdownMenuSeparator /> : null}
        {settingsHref ? (
          <DropdownMenuItem asChild icon={<Settings className="size-3.5" />}>
            <Link href={settingsHref}>Workspace settings</Link>
          </DropdownMenuItem>
        ) : onOpenSettings ? (
          <DropdownMenuItem
            icon={<Settings className="size-3.5" />}
            onSelect={onOpenSettings}
          >
            Workspace settings
          </DropdownMenuItem>
        ) : null}
        {menuFooter}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
