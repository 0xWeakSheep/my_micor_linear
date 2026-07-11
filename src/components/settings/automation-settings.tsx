"use client";

import { useState } from "react";
import { CalendarClock, FileText, Trash2 } from "lucide-react";
import type { IssueTemplate, RecurringIssue } from "@/lib/domain";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import {
  EmptyRows,
  Field,
  FormBody,
  FormFooter,
  NativeInput,
  NativeSelect,
  NativeTextarea,
  SettingsPage,
  SettingsSection,
  dividerClassName,
} from "./settings-ui";

export function TemplatesSettings() {
  const { data, mutate } = useWorkspace();
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [titleTemplate, setTitleTemplate] = useState("");
  const [descriptionTemplate, setDescriptionTemplate] = useState("");
  const [creating, setCreating] = useState(false);

  async function createTemplate() {
    if (!name.trim()) return;
    setCreating(true);
    const result = await mutate(
      "template.create",
      {
        name: name.trim(),
        teamId: teamId || null,
        titleTemplate: titleTemplate.trim(),
        descriptionTemplate,
        defaults: {},
        subIssues: [],
      },
      { successMessage: "Issue 模板已创建" },
    );
    setCreating(false);
    if (result) {
      setName("");
      setTitleTemplate("");
      setDescriptionTemplate("");
    }
  }

  return (
    <SettingsPage title="模板与重复任务" description="标准化 Issue 内容，并按固定频率自动创建例行工作。">
      <SettingsSection title="新建模板" description="模板可以面向整个工作区，也可以限定到一个团队。">
        <FormBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="模板名称" required><NativeInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Bug 报告" /></Field>
            <Field label="所属团队"><NativeSelect value={teamId} onChange={(event) => setTeamId(event.target.value)}><option value="">所有团队</option>{data.teams.map((team) => <option key={team.id} value={team.id}>{team.key} · {team.name}</option>)}</NativeSelect></Field>
          </div>
          <Field label="标题模板"><NativeInput value={titleTemplate} onChange={(event) => setTitleTemplate(event.target.value)} placeholder="[Bug] 简短描述" /></Field>
          <Field label="描述模板"><NativeTextarea value={descriptionTemplate} onChange={(event) => setDescriptionTemplate(event.target.value)} placeholder="复现步骤、预期结果、实际结果…" /></Field>
        </FormBody>
        <FormFooter><Button variant="primary" size="sm" loading={creating} disabled={!name.trim()} onClick={() => void createTemplate()}>创建模板</Button></FormFooter>
      </SettingsSection>

      <SettingsSection title="Issue 模板" description={`${data.templates.length} 个模板`}>
        {data.templates.length ? <div className={dividerClassName}>{data.templates.map((template) => <TemplateRow key={template.id} template={template} />)}</div> : <EmptyRows icon={<FileText size={16} />} title="暂无模板" description="创建模板后，新建 Issue 时可以复用标准内容。" />}
      </SettingsSection>

      <RecurringSettings />
    </SettingsPage>
  );
}

function TemplateRow({ template }: { template: IssueTemplate }) {
  const { data, mutate } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: template.name,
    teamId: template.teamId ?? "",
    titleTemplate: template.titleTemplate,
    descriptionTemplate: template.descriptionTemplate,
  });
  const [saving, setSaving] = useState(false);
  const team = data.teams.find((candidate) => candidate.id === template.teamId);

  async function save() {
    setSaving(true);
    const result = await mutate(
      "template.update",
      { templateId: template.id, changes: { ...draft, teamId: draft.teamId || null } },
      { successMessage: "模板已更新" },
    );
    setSaving(false);
    if (result) setEditing(false);
  }

  async function remove() {
    if (!window.confirm(`删除模板“${template.name}”？`)) return;
    setSaving(true);
    await mutate("template.delete", { templateId: template.id }, { successMessage: "模板已删除" });
    setSaving(false);
  }

  if (editing) {
    return (
      <div className="space-y-3 bg-surface-subtle p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2"><Field label="名称"><NativeInput value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></Field><Field label="团队"><NativeSelect value={draft.teamId} onChange={(event) => setDraft((current) => ({ ...current, teamId: event.target.value }))}><option value="">所有团队</option>{data.teams.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.key} · {candidate.name}</option>)}</NativeSelect></Field></div>
        <Field label="标题模板"><NativeInput value={draft.titleTemplate} onChange={(event) => setDraft((current) => ({ ...current, titleTemplate: event.target.value }))} /></Field>
        <Field label="描述模板"><NativeTextarea value={draft.descriptionTemplate} onChange={(event) => setDraft((current) => ({ ...current, descriptionTemplate: event.target.value }))} /></Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setEditing(false)}>取消</Button><Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>保存</Button></div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-subtle text-tertiary"><FileText size={15} /></span>
      <div className="min-w-0"><p className="truncate text-sm font-medium">{template.name}</p><p className="truncate text-xs text-tertiary">{team ? team.name : "所有团队"} · {template.titleTemplate || "无标题预设"}</p></div>
      <div className="ml-auto flex items-center gap-1"><Button variant="ghost" size="sm" onClick={() => setEditing(true)}>编辑</Button><IconButton label={`删除 ${template.name}`} icon={<Trash2 size={13} />} variant="ghost" size="icon-sm" className="hover:text-danger" disabled={saving} onClick={() => void remove()} /></div>
    </div>
  );
}

function RecurringSettings() {
  const { data, mutate } = useWorkspace();
  const [teamId, setTeamId] = useState(data.teams[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(data.templates[0]?.id ?? "");
  const [cadence, setCadence] = useState<RecurringIssue["cadence"]>("weekly");
  const [interval, setInterval] = useState(1);
  const [nextRunAt, setNextRunAt] = useState("");
  const [creating, setCreating] = useState(false);

  async function create() {
    if (!teamId || !templateId || !nextRunAt) return;
    setCreating(true);
    await mutate(
      "recurringIssue.create",
      {
        teamId,
        templateId,
        cadence,
        interval,
        nextRunAt: new Date(nextRunAt).toISOString(),
        timezone: data.workspace.timezone,
        isActive: true,
      },
      { successMessage: "重复任务已创建" },
    );
    setCreating(false);
  }

  return (
    <SettingsSection title="重复任务" description="按日、周或月从模板自动创建 Issue。">
      <FormBody>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="团队"><NativeSelect value={teamId} onChange={(event) => setTeamId(event.target.value)}>{data.teams.map((team) => <option key={team.id} value={team.id}>{team.key} · {team.name}</option>)}</NativeSelect></Field>
          <Field label="模板"><NativeSelect value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{data.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</NativeSelect></Field>
          <Field label="频率"><NativeSelect value={cadence} onChange={(event) => setCadence(event.target.value as RecurringIssue["cadence"])}><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option></NativeSelect></Field>
          <Field label="间隔"><NativeInput type="number" min={1} max={365} value={interval} onChange={(event) => setInterval(Math.max(1, Number(event.target.value)))} /></Field>
        </div>
        <Field label="下次运行"><NativeInput type="datetime-local" value={nextRunAt} onChange={(event) => setNextRunAt(event.target.value)} /></Field>
      </FormBody>
      <FormFooter><Button variant="primary" size="sm" loading={creating} disabled={!teamId || !templateId || !nextRunAt} onClick={() => void create()}>添加重复任务</Button></FormFooter>
      {data.recurringIssues.length ? <div className={`${dividerClassName} border-t border-border`}>{data.recurringIssues.map((recurring) => <RecurringRow key={recurring.id} recurring={recurring} />)}</div> : <EmptyRows icon={<CalendarClock size={16} />} title="暂无重复任务" description="选择团队和模板来创建第一条例行任务。" />}
    </SettingsSection>
  );
}

function RecurringRow({ recurring }: { recurring: RecurringIssue }) {
  const { data, mutate } = useWorkspace();
  const [saving, setSaving] = useState(false);
  const team = data.teams.find((candidate) => candidate.id === recurring.teamId);
  const template = data.templates.find((candidate) => candidate.id === recurring.templateId);

  async function toggle(isActive: boolean) {
    setSaving(true);
    await mutate("recurringIssue.update", { recurringIssueId: recurring.id, changes: { isActive } }, { successMessage: isActive ? "重复任务已启用" : "重复任务已暂停" });
    setSaving(false);
  }

  async function remove() {
    if (!window.confirm("删除这条重复任务？")) return;
    setSaving(true);
    await mutate("recurringIssue.delete", { recurringIssueId: recurring.id }, { successMessage: "重复任务已删除" });
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
      <div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-medium">{template?.name ?? "已删除模板"}</p><Badge variant={recurring.isActive ? "success" : "neutral"} size="xs">{recurring.isActive ? "运行中" : "已暂停"}</Badge></div><p className="text-xs text-tertiary">{team?.name ?? "未知团队"} · 每 {recurring.interval} {cadenceLabel(recurring.cadence)} · 下次 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(recurring.nextRunAt))}</p></div>
      <div className="ml-auto flex items-center gap-1"><Button variant="ghost" size="sm" loading={saving} onClick={() => void toggle(!recurring.isActive)}>{recurring.isActive ? "暂停" : "启用"}</Button><IconButton label="删除重复任务" icon={<Trash2 size={13} />} variant="ghost" size="icon-sm" className="hover:text-danger" disabled={saving} onClick={() => void remove()} /></div>
    </div>
  );
}

function cadenceLabel(cadence: RecurringIssue["cadence"]) {
  return cadence === "daily" ? "天" : cadence === "weekly" ? "周" : "月";
}
