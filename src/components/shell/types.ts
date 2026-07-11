import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type ShellBadgeTone = "neutral" | "accent" | "danger";

export interface WorkspaceOption {
  id: string;
  name: string;
  slug?: string;
  href?: string;
  logo?: ReactNode;
  active?: boolean;
  private?: boolean;
  meta?: string;
}

export interface ShellAction {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  onSelect?: () => void;
  active?: boolean;
  disabled?: boolean;
  badge?: string | number;
  shortcut?: string;
}

export interface SidebarNavigationItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  onSelect?: () => void;
  active?: boolean;
  disabled?: boolean;
  badge?: string | number;
  badgeTone?: ShellBadgeTone;
  shortcut?: string;
  items?: SidebarNavigationItem[];
}

export interface SidebarSection {
  id: string;
  label?: string;
  items: SidebarNavigationItem[];
  collapsible?: boolean;
  defaultExpanded?: boolean;
  action?: ShellAction;
}

export interface SidebarTeam {
  id: string;
  name: string;
  icon?: LucideIcon;
  color?: string;
  href?: string;
  onSelect?: () => void;
  active?: boolean;
  private?: boolean;
  defaultExpanded?: boolean;
  items: SidebarNavigationItem[];
}

export interface ShellBreadcrumb {
  id: string;
  label: string;
  icon?: LucideIcon;
  href?: string;
  onSelect?: () => void;
  current?: boolean;
}

export interface ShellTab {
  id: string;
  label: string;
  icon?: LucideIcon;
  href?: string;
  onSelect?: () => void;
  active?: boolean;
  disabled?: boolean;
  count?: number;
}
