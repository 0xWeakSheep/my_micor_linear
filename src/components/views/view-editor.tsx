"use client";

import { useId, useMemo, useState } from "react";
import { LayoutGrid, List, Search } from "lucide-react";
import type { ViewFilters } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { cn } from "@/lib/utils";
import { draftFromView, type ViewDraft } from "./types";

interface ViewEditorProps {
  open: boolean;
  viewId?: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: (viewId?: string) => void;
}

interface FilterOption {
  value: string;
  label: string;
  color?: string;
}

type ArrayFilterKey =
  | "teamIds"
  | "statusIds"
  | "priorities"
  | "assigneeIds"
  | "labelIds"
  | "projectIds"
  | "cycleIds";

export function ViewEditor({
  open,
  viewId,
  onOpenChange,
  onSaved,
}: ViewEditorProps) {
  const { data, mutate } = useWorkspace();
  const view = data.views.find((candidate) => candidate.id === viewId);
  const [draft, setDraft] = useState<ViewDraft>(() => draftFromView(view));
  const [saving, setSaving] = useState(false);
  const nameId = useId();

  const groups = useMemo(
    () => [
      {
        key: "teamIds" as const,
        title: "团队",
        options: data.teams.map((team) => ({
          value: team.id,
          label: `${team.key} · ${team.name}`,
          color: team.color,
        })),
      },
      {
        key: "statusIds" as const,
        title: "状态",
        options: data.states.map((state) => ({
          value: state.id,
          label: state.name,
          color: state.color,
        })),
      },
      {
        key: "priorities" as const,
        title: "优先级",
        options: [
          { value: "1", label: "紧急" },
          { value: "2", label: "高" },
          { value: "3", label: "中" },
          { value: "4", label: "低" },
          { value: "0", label: "无" },
        ],
      },
      {
        key: "assigneeIds" as const,
        title: "负责人",
        options: data.memberships.map((member) => ({
          value: member.userId,
          label: member.user.name,
        })),
      },
      {
        key: "labelIds" as const,
        title: "标签",
        options: data.labels.map((label) => ({
          value: label.id,
          label: label.name,
          color: label.color,
        })),
      },
      {
        key: "projectIds" as const,
        title: "项目",
        options: data.projects.map((project) => ({
          value: project.id,
          label: project.name,
          color: project.color,
        })),
      },
      {
        key: "cycleIds" as const,
        title: "周期",
        options: data.cycles.map((cycle) => ({
          value: cycle.id,
          label: cycle.name,
        })),
      },
    ],
    [data],
  );

  function setFilter<K extends keyof ViewFilters>(key: K, value: ViewFilters[K]) {
    setDraft((current) => ({
      ...current,
      filters: { ...current.filters, [key]: value },
    }));
  }

  async function save() {
    const name = draft.name.trim();
    if (!name) return;
    setSaving(true);
    if (view) {
      const result = await mutate(
        "view.update",
        {
          viewId: view.id,
          changes: {
            name,
            description: draft.description.trim(),
            filters: cleanFilters(draft.filters),
            layout: draft.layout,
            isShared: draft.isShared,
          },
        },
        { successMessage: "视图已更新" },
      );
      setSaving(false);
      if (result) {
        onOpenChange(false);
        onSaved?.(view.id);
      }
      return;
    }

    const created = await mutate<{ id: string }>(
      "view.create",
      {
        name,
        description: draft.description.trim(),
        icon: draft.icon,
        color: draft.color,
        filters: cleanFilters(draft.filters),
        layout: draft.layout,
        isShared: draft.isShared,
      },
      { successMessage: "视图已创建" },
    );
    setSaving(false);
    if (created) {
      onOpenChange(false);
      onSaved?.(created.id);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-h-[90dvh]">
        <DialogHeader>
          <DialogTitle>{view ? "编辑视图" : "创建视图"}</DialogTitle>
          <DialogDescription>
            保存一组筛选条件，供自己或整个工作区重复使用。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-5 pb-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="名称" htmlFor={nameId} required>
              <Input
                id={nameId}
                autoFocus
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="例如：本周高优先级"
                invalid={!draft.name.trim()}
              />
            </Field>
            <Field label="描述">
              <Input
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="这个视图适合用来做什么"
              />
            </Field>
          </div>

          <section aria-labelledby="view-display-title">
            <h3 id="view-display-title" className="mb-2 text-xs font-medium text-secondary">
              展示与权限
            </h3>
            <div className="grid gap-3 rounded-lg border border-border bg-surface-subtle p-3 sm:grid-cols-2">
              <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-surface p-1">
                <ChoiceButton
                  active={draft.layout === "list"}
                  icon={<List size={14} />}
                  onClick={() => setDraft((current) => ({ ...current, layout: "list" }))}
                >
                  列表
                </ChoiceButton>
                <ChoiceButton
                  active={draft.layout === "board"}
                  icon={<LayoutGrid size={14} />}
                  onClick={() => setDraft((current) => ({ ...current, layout: "board" }))}
                >
                  看板
                </ChoiceButton>
              </div>
              <label className="flex min-h-9 items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 text-xs">
                <span>
                  <span className="block font-medium text-primary">共享给工作区</span>
                  <span className="text-[11px] text-tertiary">关闭后仅创建人可见</span>
                </span>
                <input
                  type="checkbox"
                  checked={draft.isShared}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      isShared: event.target.checked,
                    }))
                  }
                  className="size-4 accent-[var(--accent)]"
                />
              </label>
            </div>
          </section>

          <section aria-labelledby="view-filter-title">
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 id="view-filter-title" className="text-xs font-medium text-secondary">
                  筛选条件
                </h3>
                <p className="mt-0.5 text-[11px] text-tertiary">
                  同一条件内为“任一匹配”；不同条件之间可选择全部或任一。
                </p>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-secondary">
                条件关系
                <select
                  value={draft.filters.operator ?? "and"}
                  onChange={(event) =>
                    setFilter("operator", event.target.value as "and" | "or")
                  }
                  className={selectClassName}
                >
                  <option value="and">全部满足</option>
                  <option value="or">任一满足</option>
                </select>
              </label>
            </div>

            <div className="rounded-lg border border-border">
              <div className="border-b border-border p-3">
                <label className="block text-[11px] font-medium text-secondary" htmlFor={`${nameId}-search`}>
                  搜索标题、描述、编号或评论
                </label>
                <Input
                  id={`${nameId}-search`}
                  value={draft.filters.search ?? ""}
                  onChange={(event) => setFilter("search", event.target.value)}
                  startIcon={<Search size={13} />}
                  placeholder="输入关键词"
                  containerClassName="mt-1.5"
                />
              </div>
              <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
                {groups.map((group) => (
                  <FilterPicker
                    key={group.key}
                    title={group.title}
                    options={group.options}
                    selected={selectedValues(draft.filters, group.key)}
                    onChange={(values) =>
                      setFilter(
                        group.key,
                        group.key === "priorities" ? values.map(Number) : values,
                      )
                    }
                  />
                ))}
                <label className="flex min-h-24 items-start justify-between gap-3 bg-surface p-3 text-xs">
                  <span>
                    <span className="block font-medium text-primary">包含已归档</span>
                    <span className="mt-1 block text-[11px] leading-4 text-tertiary">
                      结果中显示已经归档的 Issue
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={draft.filters.includeArchived ?? false}
                    onChange={(event) => setFilter("includeArchived", event.target.checked)}
                    className="mt-0.5 size-4 accent-[var(--accent)]"
                  />
                </label>
              </div>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!draft.name.trim()}
            onClick={() => void save()}
          >
            {view ? "保存更改" : "创建视图"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-[11px] font-medium text-secondary">
      {label}
      {required ? <span className="ml-0.5 text-danger">*</span> : null}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function ChoiceButton({
  active,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center justify-center gap-1.5 rounded text-xs text-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        active && "bg-surface-active text-primary shadow-sm",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function FilterPicker({
  title,
  options,
  selected,
  onChange,
}: {
  title: string;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset className="min-h-24 bg-surface p-3">
      <legend className="sr-only">{title}</legend>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-secondary">{title}</span>
        <span className="text-[10px] tabular-nums text-tertiary">
          {selected.length ? `已选 ${selected.length}` : "不限"}
        </span>
      </div>
      {options.length ? (
        <div className="max-h-28 space-y-0.5 overflow-y-auto pr-1">
          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <label
                key={option.value}
                className="flex min-h-7 cursor-pointer items-center gap-2 rounded px-1.5 text-[11px] text-primary hover:bg-surface-hover"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange(
                      checked
                        ? selected.filter((value) => value !== option.value)
                        : [...selected, option.value],
                    )
                  }
                  className="size-3.5 accent-[var(--accent)]"
                />
                {option.color ? (
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: option.color }}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="truncate">{option.label}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] text-tertiary">暂无可选项</p>
      )}
    </fieldset>
  );
}

function selectedValues(filters: ViewFilters, key: ArrayFilterKey): string[] {
  return (filters[key] ?? []).map(String);
}

function cleanFilters(filters: ViewFilters): ViewFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "string") return value.trim().length > 0;
      return value === true;
    }),
  ) as ViewFilters;
}

const selectClassName =
  "h-8 rounded-md border border-border bg-surface px-2 text-xs text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
