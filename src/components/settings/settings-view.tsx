"use client";

import { useState, type ComponentType } from "react";
import {
  Bell,
  Braces,
  Building2,
  ChevronsUpDown,
  CircleDot,
  Database,
  FileText,
  Palette,
  Tags,
  UserRound,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiSettings, ImportExportSettings } from "./developer-settings";
import {
  AccountSettings,
  AppearanceSettings,
  NotificationSettings,
  WorkspaceSettings,
} from "./general-settings";
import { LabelsSettings, WorkflowSettings } from "./organization-settings";
import { MembersSettings, TeamsSettings } from "./people-settings";
import { TemplatesSettings } from "./automation-settings";
import {
  DEFAULT_SETTINGS_TAB,
  isSettingsTab,
  type SettingsTab,
  type SettingsViewProps,
} from "./types";

interface NavigationItem {
  tab: SettingsTab;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

const groups: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: "个人",
    items: [
      { tab: "account", label: "账户", icon: UserRound },
      { tab: "notifications", label: "通知", icon: Bell },
      { tab: "appearance", label: "外观", icon: Palette },
    ],
  },
  {
    label: "工作区",
    items: [
      { tab: "workspace", label: "基本信息", icon: Building2 },
      { tab: "members", label: "成员", icon: Users },
      { tab: "teams", label: "团队", icon: ChevronsUpDown },
      { tab: "workflows", label: "工作流", icon: CircleDot },
      { tab: "labels", label: "标签", icon: Tags },
      { tab: "templates", label: "模板与重复任务", icon: FileText },
    ],
  },
  {
    label: "开发者",
    items: [
      { tab: "api", label: "API 与 Webhooks", icon: Braces },
      { tab: "import-export", label: "导入与导出", icon: Database },
    ],
  },
];

const pages: Record<SettingsTab, ComponentType> = {
  account: AccountSettings,
  workspace: WorkspaceSettings,
  members: MembersSettings,
  teams: TeamsSettings,
  workflows: WorkflowSettings,
  labels: LabelsSettings,
  templates: TemplatesSettings,
  notifications: NotificationSettings,
  api: ApiSettings,
  "import-export": ImportExportSettings,
  appearance: AppearanceSettings,
};

export function SettingsView({ tab, onNavigate }: SettingsViewProps) {
  const controlledTab = isSettingsTab(tab) ? tab : undefined;
  const [internalTab, setInternalTab] = useState<SettingsTab>(
    controlledTab ?? DEFAULT_SETTINGS_TAB,
  );
  const activeTab = controlledTab ?? internalTab;
  const Page = pages[activeTab];

  function navigate(nextTab: SettingsTab) {
    setInternalTab(nextTab);
    onNavigate?.(nextTab);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface md:flex-row">
      <nav
        aria-label="设置"
        className="shrink-0 border-b border-border bg-sidebar md:w-52 md:border-b-0 md:border-r"
      >
        <div className="flex gap-1 overflow-x-auto p-2 md:block md:h-full md:space-y-4 md:overflow-y-auto md:px-3 md:py-5">
          {groups.map((group) => (
            <div key={group.label} className="flex shrink-0 gap-1 md:block">
              <p className="hidden px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-tertiary md:block">
                {group.label}
              </p>
              <div className="flex gap-1 md:block md:space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.tab === activeTab;
                  return (
                    <button
                      key={item.tab}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={() => navigate(item.tab)}
                      className={cn(
                        "flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-xs text-secondary transition-colors hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:w-full",
                        active && "bg-surface-active font-medium text-primary",
                      )}
                    >
                      <Icon size={14} className={active ? "text-accent" : "text-tertiary"} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
      <main className="min-h-0 flex-1 overflow-y-auto" key={activeTab}>
        <Page />
      </main>
    </div>
  );
}
