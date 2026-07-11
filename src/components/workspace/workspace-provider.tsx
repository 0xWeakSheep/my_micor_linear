"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type {
  ActionResult,
  BootstrapData,
  Issue,
  LayoutMode,
  ViewFilters,
} from "@/lib/domain";

export interface WorkspacePreferences {
  layout: LayoutMode;
  groupBy: "status" | "priority" | "assignee" | "project" | "cycle" | "team";
  sortBy: "manual" | "priority" | "createdAt" | "updatedAt" | "dueDate";
  showSubIssues: boolean;
  compactRows: boolean;
  filters: ViewFilters;
}

interface MutationOptions {
  quiet?: boolean;
  successMessage?: string;
  refresh?: boolean;
}

interface WorkspaceContextValue {
  data: BootstrapData;
  preferences: WorkspacePreferences;
  selectedIssueId: string | null;
  selectedIssueIds: Set<string>;
  commandOpen: boolean;
  createIssueOpen: boolean;
  setPreferences: (patch: Partial<WorkspacePreferences>) => void;
  setSelectedIssueId: (issueId: string | null) => void;
  setSelectedIssueIds: (issueIds: Set<string>) => void;
  toggleIssueSelection: (issueId: string, additive?: boolean) => void;
  setCommandOpen: (open: boolean) => void;
  setCreateIssueOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
  mutate: <T>(action: string, payload: unknown, options?: MutationOptions) => Promise<T | null>;
  updateIssue: (issueId: string, changes: Partial<Issue>) => Promise<boolean>;
}

const DEFAULT_PREFERENCES: WorkspacePreferences = {
  layout: "list",
  groupBy: "status",
  sortBy: "manual",
  showSubIssues: true,
  compactRows: false,
  filters: {},
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  initialData,
  children,
}: {
  initialData: BootstrapData;
  children: ReactNode;
}) {
  const [data, setData] = useState(initialData);
  const [preferences, setPreferenceState] = useState<WorkspacePreferences>(DEFAULT_PREFERENCES);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(() => new Set());
  const [commandOpen, setCommandOpen] = useState(false);
  const [createIssueOpen, setCreateIssueOpen] = useState(false);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preferenceKey = `orbit:preferences:${initialData.workspace.id}`;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const saved = localStorage.getItem(preferenceKey);
      if (saved) {
        const next = {
          ...DEFAULT_PREFERENCES,
          ...(JSON.parse(saved) as Partial<WorkspacePreferences>),
        };
        timer = setTimeout(() => setPreferenceState(next), 0);
      }
    } catch {
      // Invalid local preferences should never prevent the workspace from loading.
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [preferenceKey]);

  const setPreferences = useCallback(
    (patch: Partial<WorkspacePreferences>) => {
      setPreferenceState((current) => {
        const next = { ...current, ...patch };
        try {
          localStorage.setItem(preferenceKey, JSON.stringify(next));
        } catch {
          // localStorage can be unavailable in hardened/private browser modes.
        }
        return next;
      });
    },
    [preferenceKey],
  );

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current;

    const request = (async () => {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(initialData.workspace.slug)}/bootstrap`,
        { cache: "no-store" },
      );
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!response.ok) throw new Error("无法刷新工作区数据");
      const result = (await response.json()) as ActionResult<BootstrapData>;
      if (!result.ok || !result.data) throw new Error(result.error ?? "无法刷新工作区数据");
      startTransition(() => setData(result.data!));
    })().finally(() => {
      refreshInFlight.current = null;
    });

    refreshInFlight.current = request;
    return request;
  }, [initialData.workspace.slug]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      void refresh().catch(() => undefined);
    }, 120);
  }, [refresh]);

  useEffect(() => {
    const source = new EventSource(
      `/api/events?workspaceId=${encodeURIComponent(initialData.workspace.id)}`,
    );
    const handleChange = () => scheduleRefresh();
    source.addEventListener("change", handleChange);

    return () => {
      source.removeEventListener("change", handleChange);
      source.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [initialData.workspace.id, scheduleRefresh]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (!isTyping && event.key === "/") {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (!isTyping && event.key.toLowerCase() === "c") {
        event.preventDefault();
        setCreateIssueOpen(true);
        return;
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setCreateIssueOpen(false);
        setSelectedIssueId(null);
        setSelectedIssueIds(new Set());
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const mutate = useCallback(
    async <T,>(
      action: string,
      payload: unknown,
      options: MutationOptions = {},
    ): Promise<T | null> => {
      try {
        const response = await fetch("/api/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, workspaceId: data.workspace.id, payload }),
        });
        const result = (await response.json()) as ActionResult<T>;
        if (!response.ok || !result.ok) throw new Error(result.error ?? "操作失败");
        if (options.refresh !== false) await refresh();
        if (options.successMessage) toast.success(options.successMessage);
        return result.data ?? null;
      } catch (error) {
        if (!options.quiet) {
          toast.error(error instanceof Error ? error.message : "操作失败，请重试");
        }
        return null;
      }
    },
    [data.workspace.id, refresh],
  );

  const updateIssue = useCallback(
    async (issueId: string, changes: Partial<Issue>) => {
      const previous = data.issues.find((issue) => issue.id === issueId);
      if (!previous) return false;

      setData((current) => ({
        ...current,
        issues: current.issues.map((issue) =>
          issue.id === issueId
            ? { ...issue, ...changes, updatedAt: new Date().toISOString() }
            : issue,
        ),
      }));

      const result = await mutate<Issue>(
        "issue.update",
        { issueId, changes },
        { quiet: true, refresh: true },
      );
      if (!result) {
        setData((current) => ({
          ...current,
          issues: current.issues.map((issue) => (issue.id === issueId ? previous : issue)),
        }));
        toast.error("Issue 更新失败，已恢复原值");
        return false;
      }
      return true;
    },
    [data.issues, mutate],
  );

  const toggleIssueSelection = useCallback((issueId: string, additive = true) => {
    setSelectedIssueIds((current) => {
      const next = additive ? new Set(current) : new Set<string>();
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      data,
      preferences,
      selectedIssueId,
      selectedIssueIds,
      commandOpen,
      createIssueOpen,
      setPreferences,
      setSelectedIssueId,
      setSelectedIssueIds,
      toggleIssueSelection,
      setCommandOpen,
      setCreateIssueOpen,
      refresh,
      mutate,
      updateIssue,
    }),
    [
      data,
      preferences,
      selectedIssueId,
      selectedIssueIds,
      commandOpen,
      createIssueOpen,
      setPreferences,
      toggleIssueSelection,
      refresh,
      mutate,
      updateIssue,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
}
