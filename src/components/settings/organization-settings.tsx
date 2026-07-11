"use client";

import { useState } from "react";
import { CircleDot, Tags, Trash2 } from "lucide-react";
import type { Label, WorkflowState, WorkflowStateType } from "@/lib/domain";
import { Button, IconButton } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import {
  EmptyRows,
  Field,
  FormBody,
  FormFooter,
  NativeInput,
  NativeSelect,
  SettingsPage,
  SettingsSection,
  dividerClassName,
} from "./settings-ui";

const stateTypes: Array<{ value: WorkflowStateType; label: string }> = [
  { value: "triage", label: "分诊" },
  { value: "backlog", label: "待办池" },
  { value: "unstarted", label: "未开始" },
  { value: "started", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "canceled", label: "已取消" },
];

export function WorkflowSettings() {
  const { data, mutate } = useWorkspace();
  const [teamId, setTeamId] = useState(data.teams[0]?.id ?? "");
  const [name, setName] = useState("");
  const [type, setType] = useState<WorkflowStateType>("unstarted");
  const [color, setColor] = useState("#8A8F98");
  const [creating, setCreating] = useState(false);
  const states = data.states.filter((state) => state.teamId === teamId).sort((a, b) => a.position - b.position);

  async function create() {
    if (!teamId || !name.trim()) return;
    setCreating(true);
    const result = await mutate(
      "workflowState.create",
      { teamId, name: name.trim(), type, color, position: states.length },
      { successMessage: "工作流状态已创建" },
    );
    setCreating(false);
    if (result) setName("");
  }

  return (
    <SettingsPage title="工作流" description="为每个团队设置从分诊到完成的 Issue 生命周期。">
      <SettingsSection title="选择团队">
        <FormBody>
          <Field label="团队">
            <NativeSelect value={teamId} onChange={(event) => setTeamId(event.target.value)}>
              {data.teams.map((team) => <option key={team.id} value={team.id}>{team.key} · {team.name}</option>)}
            </NativeSelect>
          </Field>
        </FormBody>
      </SettingsSection>
      <SettingsSection title="状态" description={`${states.length} 个状态`}>
        <FormBody className="grid gap-3 sm:grid-cols-[1fr_140px_70px_auto] sm:items-end sm:space-y-0">
          <Field label="新状态名称"><NativeInput value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：等待评审" /></Field>
          <Field label="类型"><NativeSelect value={type} onChange={(event) => setType(event.target.value as WorkflowStateType)}>{stateTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect></Field>
          <Field label="颜色"><NativeInput type="color" value={color} onChange={(event) => setColor(event.target.value)} className="p-1" /></Field>
          <Button variant="primary" size="md" loading={creating} disabled={!teamId || !name.trim()} onClick={() => void create()}>添加</Button>
        </FormBody>
        {states.length ? <div className={`${dividerClassName} border-t border-border`}>{states.map((state) => <WorkflowRow key={state.id} state={state} />)}</div> : <EmptyRows icon={<CircleDot size={16} />} title="这个团队还没有状态" description="添加第一个状态来定义团队工作流。" />}
      </SettingsSection>
    </SettingsPage>
  );
}

function WorkflowRow({ state }: { state: WorkflowState }) {
  const { mutate } = useWorkspace();
  const [draft, setDraft] = useState({ name: state.name, type: state.type, color: state.color });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await mutate("workflowState.update", { stateId: state.id, changes: draft }, { successMessage: "状态已更新" });
    setSaving(false);
  }

  async function remove() {
    if (!window.confirm(`删除状态“${state.name}”？已有 Issue 使用时可能无法删除。`)) return;
    setSaving(true);
    await mutate("workflowState.delete", { stateId: state.id }, { successMessage: "状态已删除" });
    setSaving(false);
  }

  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[22px_1fr_130px_62px_auto] sm:items-center sm:px-5">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: draft.color }} aria-hidden="true" />
      <NativeInput value={draft.name} aria-label="状态名称" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
      <NativeSelect value={draft.type} aria-label="状态类型" onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as WorkflowStateType }))}>{stateTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect>
      <NativeInput type="color" value={draft.color} aria-label="状态颜色" onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))} className="p-1" />
      <div className="flex justify-end gap-1"><Button variant="ghost" size="sm" loading={saving} onClick={() => void save()}>保存</Button><IconButton label={`删除 ${state.name}`} icon={<Trash2 size={13} />} variant="ghost" size="icon-sm" className="hover:text-danger" disabled={saving} onClick={() => void remove()} /></div>
    </div>
  );
}

export function LabelsSettings() {
  const { data, mutate } = useWorkspace();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#5E6AD2");
  const [description, setDescription] = useState("");
  const [groupName, setGroupName] = useState("");
  const [creating, setCreating] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    const result = await mutate(
      "label.create",
      { name: name.trim(), color, description: description.trim(), groupName: groupName.trim() || null },
      { successMessage: "标签已创建" },
    );
    setCreating(false);
    if (result) {
      setName("");
      setDescription("");
    }
  }

  return (
    <SettingsPage title="标签" description="维护跨团队使用的标签与标签分组。">
      <SettingsSection title="创建标签">
        <FormBody>
          <div className="grid gap-4 sm:grid-cols-[1fr_130px_70px]">
            <Field label="名称" required><NativeInput value={name} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="分组"><NativeInput value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="可选" /></Field>
            <Field label="颜色"><NativeInput type="color" value={color} onChange={(event) => setColor(event.target.value)} className="p-1" /></Field>
          </div>
          <Field label="描述"><NativeInput value={description} onChange={(event) => setDescription(event.target.value)} placeholder="标签的使用场景" /></Field>
        </FormBody>
        <FormFooter><Button variant="primary" size="sm" loading={creating} disabled={!name.trim()} onClick={() => void create()}>创建标签</Button></FormFooter>
      </SettingsSection>
      <SettingsSection title="工作区标签" description={`${data.labels.length} 个标签`}>
        {data.labels.length ? <div className={dividerClassName}>{data.labels.map((label) => <LabelRow key={label.id} label={label} />)}</div> : <EmptyRows icon={<Tags size={16} />} title="暂无标签" description="创建标签后即可给 Issue 分类。" />}
      </SettingsSection>
    </SettingsPage>
  );
}

function LabelRow({ label }: { label: Label }) {
  const { mutate } = useWorkspace();
  const [draft, setDraft] = useState({ name: label.name, color: label.color, description: label.description, groupName: label.groupName ?? "" });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await mutate("label.update", { labelId: label.id, changes: { ...draft, groupName: draft.groupName.trim() || null } }, { successMessage: "标签已更新" });
    setSaving(false);
  }

  async function remove() {
    if (!window.confirm(`删除标签“${label.name}”？`)) return;
    setSaving(true);
    await mutate("label.delete", { labelId: label.id }, { successMessage: "标签已删除" });
    setSaving(false);
  }

  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[22px_1fr_120px_1.4fr_auto] sm:items-center sm:px-5">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: draft.color }} />
      <NativeInput value={draft.name} aria-label="标签名称" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
      <NativeInput value={draft.groupName} aria-label="标签分组" placeholder="无分组" onChange={(event) => setDraft((current) => ({ ...current, groupName: event.target.value }))} />
      <NativeInput value={draft.description} aria-label="标签描述" placeholder="描述" onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
      <div className="flex items-center justify-end gap-1"><input type="color" aria-label="标签颜色" className="size-7 rounded border border-border bg-surface p-1" value={draft.color} onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))} /><Button variant="ghost" size="sm" loading={saving} onClick={() => void save()}>保存</Button><IconButton label={`删除 ${label.name}`} icon={<Trash2 size={13} />} variant="ghost" size="icon-sm" className="hover:text-danger" disabled={saving} onClick={() => void remove()} /></div>
    </div>
  );
}
