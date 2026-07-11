"use client";

import { useState } from "react";
import { Clipboard, Lock, Plus, Shield, Users } from "lucide-react";
import type { Membership, Team, WorkspaceRole } from "@/lib/domain";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export function MembersSettings() {
  const { data, mutate } = useWorkspace();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState("");

  async function invite() {
    if (!email.trim()) return;
    setInviting(true);
    const result = await mutate<{ token: string }>(
      "member.invite",
      { email: email.trim(), role },
      { successMessage: "邀请链接已创建" },
    );
    setInviting(false);
    if (result) {
      setEmail("");
      setInviteLink(`${window.location.origin}/invite/${encodeURIComponent(result.token)}`);
    }
  }

  return (
    <SettingsPage title="成员" description="邀请成员，调整工作区角色，并暂停不再需要访问的账户。">
      <SettingsSection title="邀请成员" description="生成一个安全邀请链接，通过你们现有的沟通渠道分享给被邀请者。">
        <FormBody className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end sm:space-y-0">
          <Field label="邮箱" required>
            <NativeInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" />
          </Field>
          <Field label="角色">
            <NativeSelect value={role} onChange={(event) => setRole(event.target.value as WorkspaceRole)}>
              <option value="admin">管理员</option>
              <option value="member">成员</option>
              <option value="guest">访客</option>
            </NativeSelect>
          </Field>
          <Button variant="primary" size="md" loading={inviting} disabled={!email.trim()} startIcon={<Plus size={14} />} onClick={() => void invite()}>
            邀请
          </Button>
        </FormBody>
        {inviteLink ? (
          <div className="border-t border-border bg-[var(--warning-soft)] px-4 py-3 sm:px-5">
            <p className="text-xs font-medium text-warning">邀请链接只在本次创建后显示，请立即复制。</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-surface px-2.5 py-2 text-xs text-primary">{inviteLink}</code>
              <button type="button" onClick={() => void navigator.clipboard.writeText(inviteLink)} className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-surface text-tertiary hover:bg-surface-hover hover:text-primary" aria-label="复制邀请链接">
                <Clipboard size={14} />
              </button>
            </div>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title="工作区成员" description={`${data.memberships.length} 个账户`}>
        {data.memberships.length ? (
          <div className={dividerClassName}>
            {data.memberships.map((membership) => (
              <MemberRow key={membership.id} membership={membership} />
            ))}
          </div>
        ) : (
          <EmptyRows icon={<Users size={16} />} title="暂无成员" description="发送邀请后，成员会出现在这里。" />
        )}
      </SettingsSection>
    </SettingsPage>
  );
}

function MemberRow({ membership }: { membership: Membership }) {
  const { data, mutate } = useWorkspace();
  const [updating, setUpdating] = useState(false);
  const isSelf = membership.userId === data.currentUser.id;

  async function updateRole(role: WorkspaceRole) {
    setUpdating(true);
    await mutate(
      "member.update",
      { membershipId: membership.id, changes: { role } },
      { successMessage: `${membership.user.name} 的角色已更新` },
    );
    setUpdating(false);
  }

  async function setSuspended(suspend: boolean) {
    setUpdating(true);
    await mutate(
      "member.suspend",
      { membershipId: membership.id, suspend },
      { successMessage: suspend ? "成员已暂停" : "成员已恢复" },
    );
    setUpdating(false);
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={membership.user.name} src={membership.user.avatarUrl} size="md" status={membership.status === "active" ? "online" : "offline"} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium">{membership.user.name}</p>
            {isSelf ? <Badge variant="neutral" size="xs">你</Badge> : null}
            {membership.status === "suspended" ? <Badge variant="danger" size="xs">已暂停</Badge> : null}
          </div>
          <p className="truncate text-xs text-tertiary">{membership.user.email}</p>
        </div>
      </div>
      <div className="ml-10 flex items-center gap-2 sm:ml-auto">
        <NativeSelect
          className="w-28 text-xs"
          value={membership.role}
          aria-label={`修改 ${membership.user.name} 的角色`}
          disabled={updating || isSelf}
          onChange={(event) => void updateRole(event.target.value as WorkspaceRole)}
        >
          <option value="admin">管理员</option>
          <option value="member">成员</option>
          <option value="guest">访客</option>
        </NativeSelect>
        {!isSelf ? (
          <Button
            variant="ghost"
            size="sm"
            loading={updating}
            onClick={() => void setSuspended(membership.status === "active")}
          >
            {membership.status === "active" ? "暂停" : "恢复"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function TeamsSettings() {
  const { data, mutate } = useWorkspace();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [color, setColor] = useState("#5E6AD2");
  const [isPrivate, setIsPrivate] = useState(false);
  const [triageEnabled, setTriageEnabled] = useState(false);
  const [creating, setCreating] = useState(false);

  async function create() {
    if (!name.trim() || !key.trim()) return;
    setCreating(true);
    const result = await mutate(
      "team.create",
      { name: name.trim(), key: key.trim().toLocaleUpperCase(), color, isPrivate, triageEnabled },
      { successMessage: "团队已创建" },
    );
    setCreating(false);
    if (result) {
      setName("");
      setKey("");
      setIsPrivate(false);
      setTriageEnabled(false);
    }
  }

  return (
    <SettingsPage title="团队" description="建立团队边界、标识符和访问范围。私有团队仅对加入的成员可见。">
      <SettingsSection title="创建团队">
        <FormBody>
          <div className="grid gap-4 sm:grid-cols-[1fr_120px_90px]">
            <Field label="名称" required>
              <NativeInput value={name} onChange={(event) => setName(event.target.value)} placeholder="产品工程" />
            </Field>
            <Field label="标识符" required>
              <NativeInput value={key} maxLength={8} onChange={(event) => setKey(event.target.value.replace(/[^a-zA-Z0-9]/g, "").toLocaleUpperCase())} placeholder="ENG" />
            </Field>
            <Field label="颜色">
              <NativeInput type="color" value={color} onChange={(event) => setColor(event.target.value)} className="p-1" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <label className="flex items-center gap-2 text-xs text-secondary">
              <input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} className="size-4 accent-[var(--accent)]" />
              设为私有团队
            </label>
            <label className="flex items-center gap-2 text-xs text-secondary">
              <input type="checkbox" checked={triageEnabled} onChange={(event) => setTriageEnabled(event.target.checked)} className="size-4 accent-[var(--accent)]" />
              启用 Triage 收件队列
            </label>
          </div>
        </FormBody>
        <FormFooter>
          <Button variant="primary" size="sm" loading={creating} disabled={!name.trim() || !key.trim()} onClick={() => void create()}>创建团队</Button>
        </FormFooter>
      </SettingsSection>

      <SettingsSection title="现有团队" description={`${data.teams.length} 个团队`}>
        {data.teams.length ? (
          <div className={dividerClassName}>
            {data.teams.map((team) => <TeamRow key={team.id} team={team} />)}
          </div>
        ) : (
          <EmptyRows icon={<Shield size={16} />} title="暂无团队" description="创建团队后即可按团队管理 Issue 和工作流。" />
        )}
      </SettingsSection>
    </SettingsPage>
  );
}

function TeamRow({ team }: { team: Team }) {
  const { data, mutate } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: team.name,
    key: team.key,
    description: team.description,
    color: team.color,
    isPrivate: team.isPrivate,
    triageEnabled: team.triageEnabled,
  });
  const [saving, setSaving] = useState(false);
  const [memberRoles, setMemberRoles] = useState<Record<string, "lead" | "member">>(() =>
    Object.fromEntries(
      data.teamMembers
        .filter((member) => member.teamId === team.id)
        .map((member) => [member.userId, member.role]),
    ),
  );
  const memberCount = data.teamMembers.filter((member) => member.teamId === team.id).length;
  const hasLead = Object.values(memberRoles).includes("lead");

  async function save() {
    setSaving(true);
    const result = await mutate(
      "team.update",
      {
        teamId: team.id,
        changes: {
          ...draft,
          name: draft.name.trim(),
          key: draft.key.trim().toLocaleUpperCase(),
          members: Object.entries(memberRoles).map(([userId, memberRole]) => ({ userId, role: memberRole })),
        },
      },
      { successMessage: "团队已更新" },
    );
    setSaving(false);
    if (result) setEditing(false);
  }

  if (editing) {
    return (
      <div className="space-y-4 bg-surface-subtle p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_110px_80px]">
          <Field label="名称"><NativeInput value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></Field>
          <Field label="标识符"><NativeInput value={draft.key} maxLength={8} onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value.replace(/[^a-zA-Z0-9]/g, "").toLocaleUpperCase() }))} /></Field>
          <Field label="颜色"><NativeInput type="color" value={draft.color} onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))} className="p-1" /></Field>
        </div>
        <Field label="描述"><NativeTextarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></Field>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-xs text-secondary"><input type="checkbox" checked={draft.isPrivate} onChange={(event) => setDraft((current) => ({ ...current, isPrivate: event.target.checked }))} className="size-4 accent-[var(--accent)]" />私有团队</label>
          <label className="flex items-center gap-2 text-xs text-secondary"><input type="checkbox" checked={draft.triageEnabled} onChange={(event) => setDraft((current) => ({ ...current, triageEnabled: event.target.checked }))} className="size-4 accent-[var(--accent)]" />启用 Triage</label>
        </div>
        <fieldset>
          <legend className="text-[11px] font-medium text-secondary">团队成员</legend>
          <p className="mt-1 text-[10px] text-tertiary">私有团队只对这里列出的成员可见；每个团队至少保留一名负责人。</p>
          <div className="mt-2 max-h-52 divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface">
            {data.memberships.filter((membership) => membership.status === "active").map((membership) => {
              const selectedRole = memberRoles[membership.userId];
              return (
                <div key={membership.userId} className="flex min-h-10 items-center gap-2 px-3">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedRole)}
                    onChange={(event) => setMemberRoles((current) => {
                      const next = { ...current };
                      if (event.target.checked) next[membership.userId] = "member";
                      else delete next[membership.userId];
                      return next;
                    })}
                    className="size-3.5 accent-[var(--accent)]"
                    aria-label={`将 ${membership.user.name} 加入 ${team.name}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-primary">{membership.user.name}</span>
                  {selectedRole ? (
                    <NativeSelect value={selectedRole} onChange={(event) => setMemberRoles((current) => ({ ...current, [membership.userId]: event.target.value as "lead" | "member" }))} className="h-7 w-24 text-[11px]" aria-label={`${membership.user.name} 的团队角色`}>
                      <option value="member">成员</option>
                      <option value="lead">负责人</option>
                    </NativeSelect>
                  ) : null}
                </div>
              );
            })}
          </div>
        </fieldset>
        {!hasLead ? <p className="text-xs text-danger">请至少选择一名团队负责人。</p> : null}
        <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setEditing(false)}>取消</Button><Button variant="primary" size="sm" loading={saving} disabled={!hasLead} onClick={() => void save()}>保存</Button></div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface text-xs font-semibold" style={{ color: team.color }}>{team.key.slice(0, 2)}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5"><p className="truncate text-sm font-medium">{team.name}</p>{team.isPrivate ? <Lock size={11} className="text-tertiary" aria-label="私有团队" /> : null}</div>
        <p className="truncate text-xs text-tertiary">{team.key} · {memberCount} 位成员</p>
      </div>
      <Button className="ml-auto" variant="ghost" size="sm" onClick={() => setEditing(true)}>编辑</Button>
    </div>
  );
}
