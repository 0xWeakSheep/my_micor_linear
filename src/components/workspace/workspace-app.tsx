"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Archive,
  BarChart3,
  Bell,
  Boxes,
  CheckSquare2,
  CircleDotDashed,
  Clock3,
  FlagTriangleRight,
  FileText,
  FolderKanban,
  Inbox,
  Layers3,
  LayoutList,
  ListFilter,
  LogOut,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Star,
  Sun,
} from "lucide-react";
import type { BootstrapData } from "@/lib/domain";
import { AppShell } from "@/components/shell/app-shell";
import type {
  ShellBreadcrumb,
  ShellTab,
  SidebarSection,
  SidebarTeam,
} from "@/components/shell/types";
import { Avatar } from "@/components/ui/avatar";
import { WorkspaceProvider, useWorkspace } from "./workspace-provider";
import { CommandMenu } from "./command-menu";
import { IssuesView } from "@/components/issues/issues-view";
import { ArchivedIssuesView } from "@/components/issues/archived-issues-view";
import { CreateIssueDialog } from "@/components/issues/create-issue-dialog";
import { IssueDetailDialog } from "@/components/issues/issue-detail-dialog";
import { PlanningView, type PlanningSection } from "@/components/planning";
import { InboxView } from "@/components/inbox";
import { SearchView } from "@/components/search";
import { ViewsHub } from "@/components/views";
import { SettingsView } from "@/components/settings";
import { DocumentsHub } from "@/components/documents/documents-hub";

export function WorkspaceApp({
  initialData,
  route,
}: {
  initialData: BootstrapData;
  route: string[];
}) {
  return (
    <WorkspaceProvider initialData={initialData}>
      <WorkspaceAppContent route={route} />
    </WorkspaceProvider>
  );
}

function WorkspaceAppContent({ route }: { route: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    data,
    setCommandOpen,
    setCreateIssueOpen,
    setSelectedIssueId,
  } = useWorkspace();
  const workspaceSlug = data.workspace.slug;
  const section = route[0] ?? "my-issues";
  const detail = route[1] ?? null;
  const subpage = route[2] ?? null;
  const unreadCount = data.notifications.filter(
    (notification) => !notification.readAt && !notification.snoozedUntil,
  ).length;

  useEffect(() => {
    if (section === "issue" && detail) {
      const issue = data.issues.find(
        (item) => item.identifier.toLowerCase() === detail.toLowerCase() || item.id === detail,
      );
      if (issue) setSelectedIssueId(issue.id);
    }
  }, [section, detail, data.issues, setSelectedIssueId]);

  const href = useCallback((path: string) => `/${workspaceSlug}/${path}`, [workspaceSlug]);
  const isActive = useCallback(
    (path: string) => pathname === href(path) || pathname.startsWith(`${href(path)}/`),
    [href, pathname],
  );

  const sections = useMemo<SidebarSection[]>(
    () => [
      {
        id: "personal",
        collapsible: false,
        items: [
          {
            id: "inbox",
            label: "Inbox",
            icon: Inbox,
            href: href("inbox"),
            active: section === "inbox",
            badge: unreadCount || undefined,
            badgeTone: unreadCount ? "accent" : "neutral",
          },
          {
            id: "my-issues",
            label: "My issues",
            icon: CheckSquare2,
            href: href("my-issues/assigned"),
            active: section === "my-issues",
          },
        ],
      },
      {
        id: "workspace",
        label: "Workspace",
        defaultExpanded: true,
        items: [
          {
            id: "initiatives",
            label: "Initiatives",
            icon: FlagTriangleRight,
            href: href("initiatives"),
            active: section === "initiatives",
          },
          {
            id: "projects",
            label: "Projects",
            icon: FolderKanban,
            href: href("projects"),
            active: section === "projects",
          },
          {
            id: "documents",
            label: "Documents",
            icon: FileText,
            href: href("documents"),
            active: section === "documents",
          },
          {
            id: "views",
            label: "Views",
            icon: Layers3,
            href: href("views"),
            active: section === "views",
          },
          {
            id: "insights",
            label: "Insights",
            icon: BarChart3,
            href: href("insights"),
            active: section === "insights",
          },
          {
            id: "all-issues",
            label: "All issues",
            icon: LayoutList,
            href: href("issues"),
            active: section === "issues",
          },
          {
            id: "archive",
            label: "Archive",
            icon: Archive,
            href: href("archive"),
            active: section === "archive",
          },
        ],
      },
      ...(data.favorites.length
        ? [
            {
              id: "favorites",
              label: "Favorites",
              defaultExpanded: true,
              items: data.favorites.slice(0, 8).flatMap((favorite) => {
                const entity = favoriteEntity(favorite.entityType, favorite.entityId, data);
                return entity
                  ? [
                      {
                        id: favorite.id,
                        label: entity.label,
                        icon: Star,
                        href: href(entity.path),
                        active: isActive(entity.path),
                      },
                    ]
                  : [];
              }),
            } satisfies SidebarSection,
          ]
        : []),
    ],
    [data, section, unreadCount, href, isActive],
  );

  const sidebarTeams = useMemo<SidebarTeam[]>(
    () =>
      data.teams.map((team) => {
        const teamBase = `team/${team.id}`;
        const hasTriage = team.triageEnabled;
        return {
          id: team.id,
          name: team.name,
          color: team.color,
          private: team.isPrivate,
          active: section === "team" && detail === team.id,
          href: href(`${teamBase}/issues`),
          items: [
            { id: `${team.id}:issues`, label: "Issues", icon: LayoutList, href: href(`${teamBase}/issues`), active: section === "team" && detail === team.id && (!subpage || subpage === "issues") },
            { id: `${team.id}:active`, label: "Active", icon: CircleDotDashed, href: href(`${teamBase}/active`), active: section === "team" && detail === team.id && subpage === "active" },
            { id: `${team.id}:backlog`, label: "Backlog", icon: Archive, href: href(`${teamBase}/backlog`), active: section === "team" && detail === team.id && subpage === "backlog" },
            ...(hasTriage ? [{ id: `${team.id}:triage`, label: "Triage", icon: ListFilter, href: href(`${teamBase}/triage`), active: section === "team" && detail === team.id && subpage === "triage" }] : []),
            { id: `${team.id}:cycles`, label: "Cycles", icon: Clock3, href: href(`${teamBase}/cycles`), active: section === "team" && detail === team.id && subpage === "cycles" },
            { id: `${team.id}:projects`, label: "Projects", icon: FolderKanban, href: href(`${teamBase}/projects`), active: section === "team" && detail === team.id && subpage === "projects" },
          ],
        };
      }),
    [data.teams, section, detail, subpage, href],
  );

  const header = buildHeader({
    data,
    section,
    detail,
    subpage,
    href,
    unreadCount,
    openCommand: () => setCommandOpen(true),
    createIssue: () => setCreateIssueOpen(true),
  });

  return (
    <>
      <AppShell
        sidebar={{
          workspace: {
            id: data.workspace.id,
            name: data.workspace.name,
            slug: data.workspace.slug,
            active: true,
            logo: (
              <span className="grid size-6 place-items-center rounded-md bg-accent text-[10px] font-semibold text-white">
                {data.workspace.icon.slice(0, 1)}
              </span>
            ),
          },
          sections,
          teams: sidebarTeams,
          searchAction: { label: "Search", shortcut: "/", onSelect: () => setCommandOpen(true) },
          createAction: { label: "Create issue", shortcut: "C", onSelect: () => setCreateIssueOpen(true) },
          workspaceSettingsHref: href("settings/workspace"),
          footer: <UserFooter workspaceSlug={workspaceSlug} />,
        }}
        header={header}
        contentClassName="overflow-hidden"
        skipToContentLabel="跳到主内容"
      >
        <WorkspaceRoute
          section={section}
          detail={detail}
          subpage={subpage}
          onNavigate={(path) => router.push(href(path))}
        />
      </AppShell>
      <CommandMenu workspaceSlug={workspaceSlug} />
      <CreateIssueDialog />
      <IssueDetailDialog />
    </>
  );
}

function WorkspaceRoute({
  section,
  detail,
  subpage,
  onNavigate,
}: {
  section: string;
  detail: string | null;
  subpage: string | null;
  onNavigate: (path: string) => void;
}) {
  const { data } = useWorkspace();

  if (section === "my-issues") {
    const tab = detail ?? "assigned";
    const issues = data.issues.filter((issue) => {
      if (issue.trashedAt) return false;
      if (tab === "created") return issue.creatorId === data.currentUser.id;
      if (tab === "subscribed") return issue.subscriberIds.includes(data.currentUser.id);
      if (tab === "activity") return data.activities.some((activity) => activity.actorId === data.currentUser.id && activity.entityId === issue.id);
      return issue.assigneeId === data.currentUser.id;
    });
    return <IssuesView issues={issues} title="My issues" description="你正在负责、创建或关注的工作" />;
  }

  if (section === "issues") {
    return <IssuesView issues={data.issues.filter((issue) => !issue.trashedAt)} title="All issues" description="工作区内所有可访问的 Issue" />;
  }

  if (section === "archive") return <ArchivedIssuesView />;

  if (section === "team" && detail) {
    const team = data.teams.find((item) => item.id === detail);
    if (!team) return <MissingResource title="找不到团队" />;
    if (subpage === "cycles") return <PlanningView section="cycles" teamId={team.id} onNavigate={(target) => onNavigate(`${target.section}${target.details ? `/${target.details}` : ""}`)} />;
    if (subpage === "projects") {
      const projectIds = new Set(data.projects.filter((project) => project.teamIds.includes(team.id)).map((project) => project.id));
      return <IssuesView issues={data.issues.filter((issue) => issue.teamId === team.id && issue.projectId && projectIds.has(issue.projectId))} title={`${team.name} · Projects`} />;
    }
    const stateById = new Map(data.states.map((state) => [state.id, state]));
    const issues = data.issues.filter((issue) => {
      if (issue.teamId !== team.id || issue.trashedAt) return false;
      const type = stateById.get(issue.statusId)?.type;
      if (subpage === "active") return type === "unstarted" || type === "started";
      if (subpage === "backlog") return type === "backlog";
      if (subpage === "triage") {
        if (issue.triageStatus === "snoozed") return false;
        return type === "triage" || issue.triageStatus === "pending";
      }
      return true;
    });
    const pageLabel = subpage === "active" ? "Active" : subpage === "backlog" ? "Backlog" : subpage === "triage" ? "Triage" : "Issues";
    return <IssuesView issues={issues} title={`${team.name} · ${pageLabel}`} description={team.description} />;
  }

  if (["projects", "cycles", "initiatives", "insights"].includes(section)) {
    return (
      <PlanningView
        section={section as PlanningSection}
        details={detail}
        onNavigate={(target) => onNavigate(`${target.section}${target.details ? `/${target.details}` : ""}`)}
      />
    );
  }

  if (section === "inbox") return <InboxView workspaceSlug={data.workspace.slug} onNavigate={onNavigate} />;
  if (section === "search") return <SearchView workspaceSlug={data.workspace.slug} onNavigate={onNavigate} />;
  if (section === "documents") return <DocumentsHub documentId={detail} onNavigate={(documentId) => onNavigate(documentId ? `documents/${documentId}` : "documents")} />;
  if (section === "views") return <ViewsHub details={detail} onNavigate={(viewId) => onNavigate(viewId ? `views/${viewId}` : "views")} />;
  if (section === "settings") return <SettingsView tab={detail ?? "account"} onNavigate={(tab) => onNavigate(`settings/${tab}`)} />;

  if (section === "issue" && detail) {
    return <IssuesView issues={data.issues.filter((issue) => !issue.trashedAt)} title="Issues" />;
  }

  return <IssuesView issues={data.issues.filter((issue) => !issue.trashedAt)} title="All issues" />;
}

function buildHeader({
  data,
  section,
  detail,
  subpage,
  href,
  unreadCount,
  openCommand,
  createIssue,
}: {
  data: BootstrapData;
  section: string;
  detail: string | null;
  subpage: string | null;
  href: (path: string) => string;
  unreadCount: number;
  openCommand: () => void;
  createIssue: () => void;
}) {
  const team = section === "team" ? data.teams.find((item) => item.id === detail) : undefined;
  const sectionLabels: Record<string, string> = {
    "my-issues": "My issues",
    issues: "All issues",
    archive: "Archive",
    inbox: "Inbox",
    projects: "Projects",
    documents: "Documents",
    cycles: "Cycles",
    initiatives: "Initiatives",
    insights: "Insights",
    views: "Views",
    search: "Search",
    settings: "Settings",
    issue: "Issue",
  };
  const document = section === "documents"
    ? data.documents.find((item) => item.id === detail)
    : undefined;
  const breadcrumbs: ShellBreadcrumb[] = team
    ? [
        { id: "team", label: team.name, icon: Boxes, href: href(`team/${team.id}/issues`) },
        { id: "page", label: subpage ? capitalize(subpage) : "Issues", current: true },
      ]
    : document
      ? [
          { id: "documents", label: "Documents", icon: FileText, href: href("documents") },
          { id: "document", label: document.title, current: true },
        ]
      : [{ id: "section", label: sectionLabels[section] ?? "Orbit", current: true }];
  let tabs: ShellTab[] = [];
  if (section === "my-issues") {
    tabs = ["assigned", "created", "subscribed", "activity"].map((tab) => ({
      id: tab,
      label: capitalize(tab),
      href: href(`my-issues/${tab}`),
      active: (detail ?? "assigned") === tab,
    }));
  } else if (team) {
    tabs = ["issues", "active", "backlog", "triage"].filter((tab) => tab !== "triage" || data.states.some((state) => state.teamId === team.id && state.type === "triage")).map((tab) => ({
      id: tab,
      label: capitalize(tab),
      href: href(`team/${team.id}/${tab}`),
      active: (subpage ?? "issues") === tab,
    }));
  }
  return {
    breadcrumbs,
    tabs,
    actions: [
      { id: "search", label: "Search", icon: Search, shortcut: "/", onSelect: openCommand },
      { id: "inbox", label: "Inbox", icon: Bell, href: href("inbox"), badge: unreadCount || undefined },
      { id: "create", label: "Create issue", icon: Plus, shortcut: "C", onSelect: createIssue },
      { id: "more", label: "More", icon: MoreHorizontal },
    ],
  };
}

function favoriteEntity(
  type: string,
  id: string,
  data: BootstrapData,
): { label: string; path: string } | null {
  if (type === "issue") {
    const issue = data.issues.find((item) => item.id === id);
    return issue ? { label: issue.identifier, path: `issue/${issue.identifier}` } : null;
  }
  if (type === "project") {
    const project = data.projects.find((item) => item.id === id);
    return project ? { label: project.name, path: `projects/${project.id}` } : null;
  }
  if (type === "cycle") return data.cycles.some((item) => item.id === id) ? { label: "Cycle", path: `cycles/${id}` } : null;
  if (type === "initiative") {
    const initiative = data.initiatives.find((item) => item.id === id);
    return initiative ? { label: initiative.name, path: `initiatives/${id}` } : null;
  }
  if (type === "view") {
    const view = data.views.find((item) => item.id === id);
    return view ? { label: view.name, path: `views/${id}` } : null;
  }
  if (type === "document") {
    const document = data.documents.find((item) => item.id === id);
    return document ? { label: document.title, path: `documents/${id}` } : null;
  }
  return null;
}

function UserFooter({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const { data } = useWorkspace();
  function toggleTheme() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("orbit-theme", next ? "dark" : "light");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1">
      <a href={`/${workspaceSlug}/settings/account`} className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-surface-hover">
        <Avatar name={data.currentUser.name} src={data.currentUser.avatarUrl ?? undefined} size="sm" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{data.currentUser.name}</span>
      </a>
      <button type="button" onClick={toggleTheme} className="grid size-7 place-items-center rounded-md text-tertiary hover:bg-surface-hover hover:text-primary" aria-label="切换颜色模式"><Sun size={14} className="hidden dark:block" /><Moon size={14} className="block dark:hidden" /></button>
      <button type="button" onClick={logout} className="grid size-7 place-items-center rounded-md text-tertiary hover:bg-[var(--danger-soft)] hover:text-danger" aria-label="退出登录"><LogOut size={14} /></button>
    </div>
  );
}

function MissingResource({ title }: { title: string }) {
  return <div className="grid h-full place-items-center"><div className="text-center"><Boxes size={24} className="mx-auto text-tertiary" /><h1 className="mt-3 text-sm font-medium">{title}</h1><p className="mt-1 text-xs text-tertiary">它可能已被删除，或你没有访问权限。</p></div></div>;
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1).replaceAll("-", " ");
}
