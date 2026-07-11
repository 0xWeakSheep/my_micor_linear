"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarDays, ChevronDown, Command, FileText, Loader2, Plus, Tag, X } from "lucide-react";
import type { Issue } from "@/lib/domain";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import {
  applicableIssueTemplates,
  resolveIssueTemplateDefaults,
} from "./create-issue-template";
import { PriorityIcon, StateIcon, UserAvatar } from "./issue-glyphs";

const ESTIMATE_OPTIONS = [0, 1, 2, 3, 5, 8, 13] as const;

export function CreateIssueDialog() {
  const {
    data,
    createIssueOpen,
    createIssueDefaults,
    setCreateIssueOpen,
    setSelectedIssueId,
    mutate,
  } = useWorkspace();
  const [teamId, setTeamId] = useState(data.teams[0]?.id ?? "");
  const availableStates = useMemo(
    () => data.states.filter((state) => state.teamId === teamId).sort((a, b) => a.position - b.position),
    [data.states, teamId],
  );
  const [statusId, setStatusId] = useState(availableStates.find((state) => state.type === "unstarted")?.id ?? availableStates[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [priority, setPriority] = useState<Issue["priority"]>(0);
  const [assigneeId, setAssigneeId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [cycleId, setCycleId] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(false);
  const appliedDefaultsRef = useRef<typeof createIssueDefaults>(null);
  const effectiveStatusId = availableStates.some((state) => state.id === statusId)
    ? statusId
    : (availableStates.find((state) => state.type === "unstarted") ?? availableStates[0])?.id ?? "";
  const availableTemplates = useMemo(
    () => applicableIssueTemplates(data.templates, teamId),
    [data.templates, teamId],
  );
  const selectedTemplate = availableTemplates.find((template) => template.id === templateId);

  useEffect(() => {
    if (!createIssueOpen) {
      appliedDefaultsRef.current = null;
      return;
    }
    if (!createIssueDefaults || appliedDefaultsRef.current === createIssueDefaults) return;
    appliedDefaultsRef.current = createIssueDefaults;

    const requestedState = createIssueDefaults.statusId
      ? data.states.find((state) => state.id === createIssueDefaults.statusId)
      : undefined;
    const nextTeamId = data.teams.some((team) => team.id === createIssueDefaults.teamId)
      ? createIssueDefaults.teamId!
      : requestedState?.teamId ?? data.teams[0]?.id ?? "";
    const nextStates = data.states
      .filter((state) => state.teamId === nextTeamId)
      .toSorted((left, right) => left.position - right.position);
    const nextStatus = requestedState?.teamId === nextTeamId
      ? requestedState
      : nextStates.find((state) => state.type === createIssueDefaults.statusType) ??
        nextStates.find((state) => state.type === "unstarted") ??
        nextStates[0];

    setTeamId(nextTeamId);
    setStatusId(nextStatus?.id ?? "");
    setTemplateId("");
    setProjectId(
      data.projects.some((project) => project.id === createIssueDefaults.projectId)
        ? createIssueDefaults.projectId!
        : "",
    );
    setMilestoneId("");
    setCycleId(
      data.cycles.some(
        (cycle) => cycle.id === createIssueDefaults.cycleId && cycle.teamId === nextTeamId,
      )
        ? createIssueDefaults.cycleId!
        : "",
    );
  }, [
    createIssueDefaults,
    createIssueOpen,
    data.cycles,
    data.projects,
    data.states,
    data.teams,
  ]);

  function changeTeam(nextTeamId: string) {
    setTeamId(nextTeamId);
    const nextStates = data.states
      .filter((state) => state.teamId === nextTeamId)
      .sort((a, b) => a.position - b.position);
    setStatusId((nextStates.find((state) => state.type === "unstarted") ?? nextStates[0])?.id ?? "");
    setCycleId("");
    setLabelIds([]);
    setTemplateId("");
  }

  function changeTemplate(nextTemplateId: string) {
    setTemplateId(nextTemplateId);
    if (!nextTemplateId) return;
    const template = availableTemplates.find((candidate) => candidate.id === nextTemplateId);
    if (!template) {
      setTemplateId("");
      return;
    }
    const defaults = resolveIssueTemplateDefaults(template, teamId, effectiveStatusId, data);
    setTitle(template.titleTemplate);
    setDescription(template.descriptionTemplate);
    setStatusId(defaults.statusId);
    setPriority(defaults.priority);
    setAssigneeId(defaults.assigneeId);
    setProjectId(defaults.projectId);
    setMilestoneId("");
    setCycleId(defaults.cycleId);
    setLabelIds(defaults.labelIds);
    setEstimate(defaults.estimate);
    setDueDate(defaults.dueDate);
  }

  function reset() {
    setTitle("");
    setDescription("");
    setTemplateId("");
    setPriority(0);
    setAssigneeId("");
    setProjectId("");
    setMilestoneId("");
    setCycleId("");
    setLabelIds([]);
    setEstimate(null);
    setDueDate("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !teamId || !effectiveStatusId) return;
    setLoading(true);
    const issue = await mutate<Issue>(
      "issue.create",
      {
        teamId,
        statusId: effectiveStatusId,
        title: title.trim(),
        description: description.trim(),
        priority,
        assigneeId: assigneeId || null,
        projectId: projectId || null,
        ...(milestoneId ? { milestoneId } : {}),
        cycleId: cycleId || null,
        labelIds,
        estimate,
        dueDate: dueDate || null,
        ...(selectedTemplate?.subIssues.length
          ? { subIssues: selectedTemplate.subIssues }
          : {}),
      },
      {
        successMessage: selectedTemplate?.subIssues.length
          ? `Issue 及 ${selectedTemplate.subIssues.length} 个子 Issue 已创建`
          : "Issue 已创建",
      },
    );
    setLoading(false);
    if (issue) {
      setCreateIssueOpen(false);
      reset();
      setSelectedIssueId(issue.id);
    }
  }

  return (
    <Dialog.Root open={createIssueOpen} onOpenChange={setCreateIssueOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--overlay)] backdrop-blur-[2px] data-[state=closed]:animate-[fade-out_120ms_ease] data-[state=open]:animate-[fade-in_120ms_ease]" />
        <Dialog.Content
          className="fixed left-1/2 top-[12vh] z-50 w-[min(680px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-xl border border-border-strong bg-surface-raised shadow-[var(--shadow-dialog)] outline-none max-sm:top-3 max-sm:h-[calc(100dvh-24px)]"
          aria-describedby="create-issue-description"
        >
          <Dialog.Title className="sr-only">新建 Issue</Dialog.Title>
          <Dialog.Description id="create-issue-description" className="sr-only">
            创建一个包含团队、状态和属性的新 Issue。
          </Dialog.Description>
          <form onSubmit={handleSubmit} className="flex max-h-[76vh] flex-col max-sm:h-full max-sm:max-h-none">
            <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
              <SelectWithIcon
                label="团队"
                value={teamId}
                onChange={changeTeam}
                options={data.teams.map((team) => ({ value: team.id, label: team.name, color: team.color, short: team.key }))}
              />
              <span className="text-xs text-tertiary">新 Issue</span>
              <Dialog.Close asChild>
                <button type="button" className="ml-auto grid size-7 place-items-center rounded text-tertiary transition-colors hover:bg-surface-hover hover:text-primary" aria-label="关闭">
                  <X size={15} />
                </button>
              </Dialog.Close>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Issue 标题"
                className="w-full border-0 bg-transparent text-xl font-medium tracking-[-0.025em] outline-none placeholder:text-placeholder sm:text-[22px]"
                required
              />
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="添加描述… 支持 Markdown"
                className="mt-3 min-h-32 w-full resize-none border-0 bg-transparent text-sm leading-6 text-secondary outline-none placeholder:text-placeholder"
              />
            </div>

            <footer className="shrink-0 border-t border-border p-3">
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {availableTemplates.length > 0 ? (
                  <PropertySelect
                    label="模板"
                    value={templateId}
                    onChange={changeTemplate}
                    options={[
                      { value: "", label: "无模板" },
                      ...availableTemplates.map((template) => ({
                        value: template.id,
                        label: template.name,
                      })),
                    ]}
                    icon={<FileText size={13} />}
                  />
                ) : null}
                <PropertySelect
                  label="状态"
                  value={effectiveStatusId}
                  onChange={setStatusId}
                  options={availableStates.map((state) => ({ value: state.id, label: state.name }))}
                  icon={<StateIcon state={availableStates.find((state) => state.id === effectiveStatusId)} size={13} />}
                />
                <PropertySelect
                  label="优先级"
                  value={String(priority)}
                  onChange={(value) => setPriority(Number(value) as Issue["priority"])}
                  options={[
                    { value: "0", label: "无优先级" },
                    { value: "1", label: "紧急" },
                    { value: "2", label: "高" },
                    { value: "3", label: "中" },
                    { value: "4", label: "低" },
                  ]}
                  icon={<PriorityIcon priority={priority} size={13} />}
                />
                <PropertySelect
                  label="负责人"
                  value={assigneeId}
                  onChange={setAssigneeId}
                  options={[{ value: "", label: "未分配" }, ...data.memberships.map((member) => ({ value: member.userId, label: member.user.name }))]}
                  icon={<UserAvatar user={data.memberships.find((member) => member.userId === assigneeId)?.user} size={15} />}
                />
                <PropertySelect
                  label="项目"
                  value={projectId}
                  onChange={(value) => {
                    setProjectId(value);
                    setMilestoneId("");
                  }}
                  options={[{ value: "", label: "无项目" }, ...data.projects.map((project) => ({ value: project.id, label: project.name }))]}
                />
                {projectId ? (
                  <PropertySelect
                    label="里程碑"
                    value={milestoneId}
                    onChange={setMilestoneId}
                    options={[
                      { value: "", label: "无里程碑" },
                      ...data.milestones
                        .filter((milestone) => milestone.projectId === projectId)
                        .map((milestone) => ({ value: milestone.id, label: milestone.name })),
                    ]}
                  />
                ) : null}
                <PropertySelect
                  label="周期"
                  value={cycleId}
                  onChange={setCycleId}
                  options={[
                    { value: "", label: "无周期" },
                    ...data.cycles.filter((cycle) => cycle.teamId === teamId).map((cycle) => ({ value: cycle.id, label: `Cycle ${cycle.number}` })),
                  ]}
                />
                {labelIds.map((labelId) => {
                  const label = data.labels.find((candidate) => candidate.id === labelId);
                  if (!label) return null;
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => setLabelIds((current) => current.filter((id) => id !== label.id))}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-[11px] text-secondary transition-colors hover:bg-surface-hover"
                      aria-label={`移除标签 ${label.name}`}
                    >
                      <span className="size-2 rounded-full" style={{ backgroundColor: label.color }} />
                      {label.name}
                      <X size={10} className="text-tertiary" />
                    </button>
                  );
                })}
                <PropertySelect
                  label="标签"
                  value=""
                  onChange={(value) => value && setLabelIds((current) => current.includes(value) ? current : [...current, value])}
                  options={[
                    { value: "", label: "添加标签" },
                    ...data.labels
                      .filter((label) => !labelIds.includes(label.id))
                      .map((label) => ({ value: label.id, label: label.name })),
                  ]}
                  icon={<Tag size={13} />}
                />
                <PropertySelect
                  label="估算"
                  value={estimate === null ? "" : String(estimate)}
                  onChange={(value) => setEstimate(value ? Number(value) : null)}
                  options={[
                    { value: "", label: "无估算" },
                    ...(!ESTIMATE_OPTIONS.includes(estimate as typeof ESTIMATE_OPTIONS[number]) && estimate !== null
                      ? [{ value: String(estimate), label: `${estimate} 点` }]
                      : []),
                    ...ESTIMATE_OPTIONS.map((value) => ({ value: String(value), label: `${value} 点` })),
                  ]}
                />
                <PropertyDateInput value={dueDate} onChange={setDueDate} />
              </div>
              <div className="flex items-center">
                <p className="hidden items-center gap-1 text-[11px] text-tertiary sm:flex">
                  <Command size={11} /> Enter 创建
                </p>
                {selectedTemplate?.subIssues.length ? (
                  <span className="ml-3 text-[11px] text-tertiary">
                    将同时创建 {selectedTemplate.subIssues.length} 个子 Issue
                  </span>
                ) : null}
                <button type="submit" disabled={loading || !title.trim()} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50">
                  {loading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  创建 Issue
                </button>
              </div>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PropertySelect({
  label,
  value,
  onChange,
  options,
  icon,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  icon?: React.ReactNode;
}) {
  return (
    <label className="relative inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-[11px] text-secondary transition-colors hover:bg-surface-hover">
      {icon}
      <span>{options.find((option) => option.value === value)?.label ?? label}</span>
      <ChevronDown size={11} className="text-tertiary" />
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function PropertyDateInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-[11px] text-secondary transition-colors hover:bg-surface-hover">
      <CalendarDays size={13} />
      <span>{value ? `截止 ${value}` : "截止日期"}</span>
      {value ? (
        <button
          type="button"
          aria-label="清除截止日期"
          onClick={(event) => {
            event.preventDefault();
            onChange("");
          }}
          className="relative z-10 -mr-1 grid size-4 place-items-center rounded text-tertiary hover:bg-surface-active hover:text-primary"
        >
          <X size={10} />
        </button>
      ) : null}
      <input
        type="date"
        aria-label="截止日期"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </div>
  );
}

function SelectWithIcon({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; color: string; short: string }>;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <label className="relative inline-flex h-7 items-center gap-1.5 rounded px-1.5 text-xs font-medium transition-colors hover:bg-surface-hover">
      <span className="grid size-4 place-items-center rounded-[4px] text-[8px] font-bold text-white" style={{ background: current?.color }}>{current?.short.slice(0, 1)}</span>
      {current?.short ?? label}
      <ChevronDown size={11} className="text-tertiary" />
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
