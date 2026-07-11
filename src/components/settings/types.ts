export type SettingsTab =
  | "account"
  | "workspace"
  | "members"
  | "teams"
  | "workflows"
  | "labels"
  | "templates"
  | "notifications"
  | "api"
  | "import-export"
  | "appearance";

export interface SettingsViewProps {
  tab?: string | null;
  details?: string | null;
  onNavigate?: (tab: SettingsTab) => void;
}

export const DEFAULT_SETTINGS_TAB: SettingsTab = "account";

export function isSettingsTab(value: string | null | undefined): value is SettingsTab {
  return [
    "account",
    "workspace",
    "members",
    "teams",
    "workflows",
    "labels",
    "templates",
    "notifications",
    "api",
    "import-export",
    "appearance",
  ].includes(value ?? "");
}
