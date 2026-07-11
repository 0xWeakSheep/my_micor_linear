"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  AtSign,
  FileText,
  Filter,
  FolderKanban,
  Hash,
  Search,
  Tag,
  UsersRound,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import type { BootstrapData, Issue } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { StatusIcon } from "@/components/ui/status-icon";

export interface SearchViewProps {
  workspaceSlug: string;
  onNavigate?: (path: string) => void;
}

type SearchResultKind = "issue" | "project" | "document" | "member";
type FilterKind = "assignee" | "team" | "status" | "project" | "label";

interface SearchResult {
  key: string;
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle: string;
  searchText: string;
  sortDate: string;
}

interface SearchGroup {
  id: SearchResultKind;
  label: string;
  results: SearchResult[];
}

interface ActiveFilter {
  id: string;
  kind: FilterKind;
  valueId: string;
  label: string;
}

interface SearchHint {
  id: string;
  kind: FilterKind;
  valueId: string;
  label: string;
  description: string;
  icon: LucideIcon;
  color?: string;
}

const filterLabels: Record<FilterKind, string> = {
  assignee: "负责人",
  team: "团队",
  status: "状态",
  project: "项目",
  label: "标签",
};

const filterIcons: Record<FilterKind, LucideIcon> = {
  assignee: AtSign,
  team: UsersRound,
  status: Workflow,
  project: FolderKanban,
  label: Tag,
};

const resultGroupLabels: Record<SearchResultKind, string> = {
  issue: "Issues",
  project: "Projects",
  document: "Documents",
  member: "Members",
};

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKD");
}

function scopeAndTerms(query: string): {
  scope: SearchResultKind | "all";
  terms: string[];
  plainQuery: string;
} {
  const trimmed = query.trim();
  const match = /^(i|p|d|u)\s+(.+)$/i.exec(trimmed);
  const scopeMap: Record<string, SearchResultKind> = {
    i: "issue",
    p: "project",
    d: "document",
    u: "member",
  };
  const scopedQuery = match ? match[2] ?? "" : trimmed;
  const plainQuery = scopedQuery
    .split(/\s+/)
    .filter((token) => !token.startsWith("@") && !/^(assignee|team|status|project|label):/i.test(token))
    .join(" ")
    .trim();
  return {
    scope: match ? scopeMap[match[1]!.toLocaleLowerCase()] ?? "all" : "all",
    terms: normalize(plainQuery).split(/\s+/).filter(Boolean),
    plainQuery,
  };
}

function matchesTerms(searchText: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const normalized = normalize(searchText);
  return terms.every((term) => normalized.includes(term));
}

function matchesIssueFilters(issue: Issue, filters: ActiveFilter[]): boolean {
  return filters.every((filter) => {
    switch (filter.kind) {
      case "assignee":
        return issue.assigneeId === filter.valueId;
      case "team":
        return issue.teamId === filter.valueId;
      case "status":
        return issue.statusId === filter.valueId;
      case "project":
        return issue.projectId === filter.valueId;
      case "label":
        return issue.labelIds.includes(filter.valueId);
    }
  });
}

function hintRequest(query: string): { kind: FilterKind; term: string } | null {
  const lastToken = query.trimEnd().split(/\s+/).at(-1) ?? "";
  if (lastToken.startsWith("@")) {
    return { kind: "assignee", term: normalize(lastToken.slice(1)) };
  }
  const match = /^(assignee|team|status|project|label):(.*)$/i.exec(lastToken);
  if (!match) return null;
  return {
    kind: match[1]!.toLocaleLowerCase() as FilterKind,
    term: normalize(match[2] ?? ""),
  };
}

function buildHints(data: BootstrapData, request: ReturnType<typeof hintRequest>): SearchHint[] {
  if (!request) return [];
  const { kind, term } = request;
  const Icon = filterIcons[kind];
  const options: SearchHint[] =
    kind === "assignee"
      ? data.memberships.map((membership) => ({
          id: `assignee:${membership.userId}`,
          kind,
          valueId: membership.userId,
          label: membership.user.name,
          description: membership.user.email,
          icon: Icon,
        }))
      : kind === "team"
        ? data.teams.map((team) => ({
            id: `team:${team.id}`,
            kind,
            valueId: team.id,
            label: team.name,
            description: team.key,
            icon: Icon,
            color: team.color,
          }))
        : kind === "status"
          ? data.states.map((state) => ({
              id: `status:${state.id}`,
              kind,
              valueId: state.id,
              label: state.name,
              description: data.teams.find((team) => team.id === state.teamId)?.name ?? "Workflow",
              icon: Icon,
              color: state.color,
            }))
          : kind === "project"
            ? data.projects.map((project) => ({
                id: `project:${project.id}`,
                kind,
                valueId: project.id,
                label: project.name,
                description: project.summary,
                icon: Icon,
                color: project.color,
              }))
            : data.labels.map((label) => ({
                id: `label:${label.id}`,
                kind,
                valueId: label.id,
                label: label.name,
                description: label.groupName ?? "Label",
                icon: Icon,
                color: label.color,
              }));
  return options.filter((option) => !term || normalize(option.label).includes(term)).slice(0, 8);
}

function removeLastQueryToken(query: string): string {
  const trimmed = query.trimEnd();
  const splitAt = trimmed.lastIndexOf(" ");
  return splitAt >= 0 ? `${trimmed.slice(0, splitAt).trimEnd()} ` : "";
}

function HighlightedText({ value, query }: { value: string; query: string }) {
  const needle = query.trim().split(/\s+/).find(Boolean);
  if (!needle) return value;
  const index = normalize(value).indexOf(normalize(needle));
  if (index < 0) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark className="rounded-sm bg-accent-soft px-0.5 text-inherit">{value.slice(index, index + needle.length)}</mark>
      {value.slice(index + needle.length)}
    </>
  );
}

function ResultIcon({ result, data }: { result: SearchResult; data: BootstrapData }) {
  if (result.kind === "issue") {
    const issue = data.issues.find((item) => item.id === result.id);
    const state = data.states.find((item) => item.id === issue?.statusId);
    return state ? (
      <StatusIcon status={state.type} color={state.color} label={state.name} size={16} />
    ) : (
      <Hash className="size-4 text-tertiary" />
    );
  }
  if (result.kind === "project") {
    const project = data.projects.find((item) => item.id === result.id);
    return (
      <span className="flex size-6 items-center justify-center rounded-md border border-border bg-surface-subtle">
        <FolderKanban className="size-3.5" style={{ color: project?.color }} />
      </span>
    );
  }
  if (result.kind === "document") {
    return (
      <span className="flex size-6 items-center justify-center rounded-md border border-border bg-surface-subtle text-tertiary">
        <FileText className="size-3.5" />
      </span>
    );
  }
  const member = data.memberships.find((item) => item.userId === result.id)?.user;
  return <Avatar name={member?.name ?? result.title} src={member?.avatarUrl} size="sm" />;
}

function SearchResultRow({
  result,
  data,
  query,
  selected,
  index,
  onSelect,
  onHover,
  rowRef,
}: {
  result: SearchResult;
  data: BootstrapData;
  query: string;
  selected: boolean;
  index: number;
  onSelect: () => void;
  onHover: () => void;
  rowRef: (element: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={rowRef}
      id={`search-result-${index}`}
      type="button"
      role="option"
      aria-selected={selected}
      onMouseEnter={onHover}
      onClick={onSelect}
      className={cn(
        "group flex min-h-10 w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
        selected ? "bg-surface-active" : "hover:bg-surface-hover",
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center">
        <ResultIcon result={result} data={data} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-primary">
          <HighlightedText value={result.title} query={query} />
        </span>
        {result.subtitle ? (
          <span className="mt-0.5 block truncate text-[11px] text-tertiary">{result.subtitle}</span>
        ) : null}
      </span>
      <span className="hidden text-[10px] text-tertiary group-hover:block sm:block">
        {resultGroupLabels[result.kind].slice(0, -1)}
      </span>
    </button>
  );
}

function SearchEmpty({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center px-8 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-surface-subtle text-tertiary">
        <Search className="size-4" />
      </span>
      <h2 className="mt-3 text-sm font-medium">{hasQuery ? "没有匹配结果" : "开始搜索"}</h2>
      <p className="mt-1 max-w-sm text-xs leading-5 text-tertiary">
        {hasQuery
          ? "尝试更少的关键词，或移除一个属性筛选。"
          : "搜索 Issue、项目、文档或成员。使用 @、team:、status: 添加筛选。"}
      </p>
    </div>
  );
}

export function SearchView({ workspaceSlug, onNavigate }: SearchViewProps) {
  const router = useRouter();
  const { data, setSelectedIssueId } = useWorkspace();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeHintIndex, setActiveHintIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef(new Map<number, HTMLButtonElement>());

  const parsed = useMemo(() => scopeAndTerms(query), [query]);
  const request = useMemo(() => hintRequest(query), [query]);
  const hints = useMemo(() => buildHints(data, request), [data, request]);
  const hintsOpen = focused && Boolean(request) && hints.length > 0;

  const groups = useMemo<SearchGroup[]>(() => {
    const issueResults: SearchResult[] = data.issues
      .filter((issue) => !issue.trashedAt && !issue.archivedAt)
      .filter((issue) => matchesIssueFilters(issue, filters))
      .filter((issue) => {
        const comments = data.comments.filter((comment) => comment.issueId === issue.id);
        return matchesTerms(
          [issue.identifier, issue.title, issue.description, ...comments.map((comment) => comment.body)].join(" "),
          parsed.terms,
        );
      })
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 80)
      .map((issue) => {
        const team = data.teams.find((item) => item.id === issue.teamId);
        return {
          key: `issue:${issue.id}`,
          kind: "issue" as const,
          id: issue.id,
          title: `${issue.identifier} ${issue.title}`,
          subtitle: [team?.name, issue.description].filter(Boolean).join(" · "),
          searchText: `${issue.identifier} ${issue.title} ${issue.description}`,
          sortDate: issue.updatedAt,
        };
      });

    const projectResults: SearchResult[] =
      filters.length > 0
        ? []
        : data.projects
            .filter((project) => matchesTerms(`${project.name} ${project.summary} ${project.description}`, parsed.terms))
            .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 30)
            .map((project) => ({
              key: `project:${project.id}`,
              kind: "project" as const,
              id: project.id,
              title: project.name,
              subtitle: project.summary,
              searchText: `${project.name} ${project.summary}`,
              sortDate: project.updatedAt,
            }));

    const documentResults: SearchResult[] =
      filters.length > 0
        ? []
        : data.documents
            .filter((document) => matchesTerms(`${document.title} ${document.content}`, parsed.terms))
            .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 30)
            .map((document) => ({
              key: `document:${document.id}`,
              kind: "document" as const,
              id: document.id,
              title: document.title,
              subtitle: document.content.replace(/[#*_`>\n]/g, " ").replace(/\s+/g, " ").slice(0, 140),
              searchText: `${document.title} ${document.content}`,
              sortDate: document.updatedAt,
            }));

    const memberResults: SearchResult[] =
      filters.length > 0
        ? []
        : data.memberships
            .filter((membership) =>
              matchesTerms(`${membership.user.name} ${membership.user.email} ${membership.role}`, parsed.terms),
            )
            .slice(0, 30)
            .map((membership) => ({
              key: `member:${membership.userId}`,
              kind: "member" as const,
              id: membership.userId,
              title: membership.user.name,
              subtitle: `${membership.user.email} · ${membership.role}`,
              searchText: `${membership.user.name} ${membership.user.email}`,
              sortDate: membership.joinedAt,
            }));

    const candidates: SearchGroup[] = [
      { id: "issue", label: parsed.plainQuery || filters.length ? "Issues" : "Recent issues", results: issueResults },
      { id: "project", label: "Projects", results: projectResults },
      { id: "document", label: "Documents", results: documentResults },
      { id: "member", label: "Members", results: memberResults },
    ];
    return candidates.filter(
      (group) => group.results.length > 0 && (parsed.scope === "all" || parsed.scope === group.id),
    );
  }, [data, filters, parsed]);

  const flatResults = useMemo(() => groups.flatMap((group) => group.results), [groups]);
  const effectiveActiveIndex = Math.min(activeIndex, Math.max(0, flatResults.length - 1));
  const activeResult = flatResults[effectiveActiveIndex];

  useEffect(() => {
    resultRefs.current.get(effectiveActiveIndex)?.scrollIntoView({ block: "nearest" });
  }, [effectiveActiveIndex]);

  useEffect(() => {
    inputRef.current?.focus();
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const navigate = useCallback(
    (path: string) => {
      if (onNavigate) onNavigate(path);
      else router.push(`/${workspaceSlug}/${path}`);
    },
    [onNavigate, router, workspaceSlug],
  );

  const openResult = useCallback(
    (result: SearchResult) => {
      if (result.kind === "issue") {
        setSelectedIssueId(result.id);
      } else if (result.kind === "project") {
        navigate(`projects/${result.id}`);
      } else if (result.kind === "document") {
        navigate(`documents/${result.id}`);
      } else {
        navigate(`members/${result.id}`);
      }
    },
    [navigate, setSelectedIssueId],
  );

  const chooseHint = (hint: SearchHint) => {
    setFilters((current) => {
      const withoutSameKind = current.filter((filter) => filter.kind !== hint.kind);
      return [
        ...withoutSameKind,
        { id: hint.id, kind: hint.kind, valueId: hint.valueId, label: hint.label },
      ];
    });
    setQuery(removeLastQueryToken(query));
    setActiveHintIndex(0);
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (hintsOpen) setActiveHintIndex((index) => Math.min(index + 1, hints.length - 1));
      else setActiveIndex((index) => Math.min(index + 1, flatResults.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (hintsOpen) setActiveHintIndex((index) => Math.max(index - 1, 0));
      else setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (hintsOpen && hints[activeHintIndex]) chooseHint(hints[activeHintIndex]);
      else if (activeResult) openResult(activeResult);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (request) setQuery(removeLastQueryToken(query));
      else if (query) setQuery("");
      else if (filters.length > 0) setFilters([]);
      else inputRef.current?.blur();
    }
  };

  let runningIndex = -1;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-4 sm:px-5">
        <Search className="mr-2 size-4 text-tertiary" aria-hidden="true" />
        <h1 className="text-sm font-semibold tracking-[-0.015em]">Search</h1>
        <span className="ml-auto hidden text-[10px] text-tertiary sm:block">
          在 Issues、Projects、Documents 和 Members 中搜索
        </span>
      </header>

      <div className="relative shrink-0 border-b border-border bg-background px-3 py-3 sm:px-5">
        <div className="mx-auto max-w-5xl">
          <div className="flex min-h-10 items-center gap-2 rounded-lg border border-border-strong bg-surface-raised px-3 shadow-[0_1px_2px_rgb(0_0_0/4%)] focus-within:border-accent focus-within:ring-2 focus-within:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)]">
            <Search className="size-4 shrink-0 text-tertiary" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
                setActiveHintIndex(0);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => window.setTimeout(() => setFocused(false), 100)}
              onKeyDown={handleInputKeyDown}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-[var(--text-placeholder)]"
              placeholder="搜索… 试试 ENG-105、@maya 或 team:engineering"
              role="combobox"
              aria-label="全局搜索"
              aria-expanded={hintsOpen}
              aria-controls={hintsOpen ? "search-hints" : "search-results"}
              aria-activedescendant={
                hintsOpen
                  ? hints[activeHintIndex]
                    ? `search-hint-${activeHintIndex}`
                    : undefined
                  : activeResult
                    ? `search-result-${effectiveActiveIndex}`
                    : undefined
              }
              autoComplete="off"
              spellCheck={false}
            />
            {query ? (
              <IconButton
                label="清空搜索"
                icon={<X className="size-3.5" />}
                variant="ghost"
                size="icon-xs"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery("");
                  setActiveIndex(0);
                  inputRef.current?.focus();
                }}
              />
            ) : (
              <kbd className="rounded border border-border bg-surface-subtle px-1.5 py-0.5 font-sans text-[9px] text-tertiary">
                ⌘F
              </kbd>
            )}
          </div>

          {filters.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Active search filters">
              <Filter className="mr-0.5 size-3.5 text-tertiary" aria-hidden="true" />
              {filters.map((filter) => {
                const Icon = filterIcons[filter.kind];
                return (
                  <Badge key={filter.id} variant="accent" size="sm" icon={<Icon className="size-3" />}>
                    <span>{filterLabels[filter.kind]}: {filter.label}</span>
                    <button
                      type="button"
                      className="ml-0.5 rounded-sm p-0.5 hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
                      aria-label={`移除${filterLabels[filter.kind]}筛选 ${filter.label}`}
                      onClick={() => setFilters((current) => current.filter((item) => item.id !== filter.id))}
                    >
                      <X className="size-2.5" />
                    </button>
                  </Badge>
                );
              })}
              <button
                type="button"
                className="h-6 rounded-md px-2 text-[10px] text-tertiary hover:bg-surface-hover hover:text-secondary"
                onClick={() => setFilters([])}
              >
                清除筛选
              </button>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-tertiary">
              <span><kbd className="text-secondary">@</kbd> 负责人</span>
              <span><kbd className="text-secondary">team:</kbd> 团队</span>
              <span><kbd className="text-secondary">status:</kbd> 状态</span>
              <span><kbd className="text-secondary">project:</kbd> 项目</span>
              <span className="ml-auto hidden sm:inline">i / p / d / u + 空格限定类型</span>
            </div>
          )}

          {hintsOpen ? (
            <div
              id="search-hints"
              role="listbox"
              aria-label={`${filterLabels[request!.kind]} suggestions`}
              className="absolute left-3 right-3 top-[58px] z-30 mx-auto max-h-72 max-w-5xl overflow-y-auto rounded-lg border border-border-strong bg-surface-raised p-1.5 shadow-[var(--shadow-popover)] sm:left-5 sm:right-5"
            >
              <div className="px-2 pb-1 pt-0.5 text-[10px] font-medium text-tertiary">
                按{filterLabels[request!.kind]}筛选
              </div>
              {hints.map((hint, index) => {
                const Icon = hint.icon;
                return (
                  <button
                    id={`search-hint-${index}`}
                    key={hint.id}
                    type="button"
                    role="option"
                    aria-selected={activeHintIndex === index}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveHintIndex(index)}
                    onClick={() => chooseHint(hint)}
                    className={cn(
                      "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left outline-none",
                      activeHintIndex === index ? "bg-surface-active" : "hover:bg-surface-hover",
                    )}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-subtle">
                      <Icon className="size-3.5" style={{ color: hint.color }} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{hint.label}</span>
                    <span className="max-w-52 truncate text-[10px] text-tertiary">{hint.description}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div id="search-results" role="listbox" aria-label="Search results" className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-3 py-3 sm:px-5 sm:py-5">
          {groups.length > 0 ? (
            <div className="space-y-5">
              {groups.map((group) => (
                <section key={group.id} aria-labelledby={`search-group-${group.id}`}>
                  <div className="mb-1.5 flex h-6 items-center px-2">
                    <h2 id={`search-group-${group.id}`} className="text-[11px] font-medium text-tertiary">
                      {group.label}
                    </h2>
                    <span className="ml-2 text-[10px] tabular-nums text-tertiary">{group.results.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {group.results.map((result) => {
                      runningIndex += 1;
                      const resultIndex = runningIndex;
                      return (
                        <SearchResultRow
                          key={result.key}
                          result={result}
                          data={data}
                          query={parsed.plainQuery}
                          index={resultIndex}
                          selected={effectiveActiveIndex === resultIndex}
                          onHover={() => setActiveIndex(resultIndex)}
                          onSelect={() => openResult(result)}
                          rowRef={(element) => {
                            if (element) resultRefs.current.set(resultIndex, element);
                            else resultRefs.current.delete(resultIndex);
                          }}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <SearchEmpty hasQuery={Boolean(parsed.plainQuery || filters.length)} />
          )}
        </div>
      </div>

      <footer className="hidden h-8 shrink-0 items-center gap-4 border-t border-border px-4 text-[10px] text-tertiary sm:flex">
        <span><kbd>↑↓</kbd> 导航</span>
        <span><kbd>↵</kbd> 打开</span>
        <span><kbd>Esc</kbd> 清除</span>
        <span className="ml-auto">{flatResults.length} 个结果</span>
      </footer>
    </div>
  );
}
