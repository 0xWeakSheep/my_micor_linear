"use client";

import { useState } from "react";
import { Bell, Check, Laptop, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/domain";
import {
  Field,
  FormBody,
  FormFooter,
  NativeInput,
  SettingsPage,
  SettingsSection,
  SwitchRow,
  dividerClassName,
} from "./settings-ui";

export function AccountSettings() {
  const { data, mutate } = useWorkspace();
  const [name, setName] = useState(data.currentUser.name);
  const [email, setEmail] = useState(data.currentUser.email);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  async function save() {
    setSaving(true);
    await mutate(
      "account.update",
      { changes: { name: name.trim(), email: email.trim() } },
      { successMessage: "账户资料已更新" },
    );
    setSaving(false);
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    setPasswordSaving(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = (await response.json()) as ActionResult<{ revokedSessions: number }>;
      if (!response.ok || !result.ok) throw new Error(result.error ?? "密码修改失败");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success(
        result.data?.revokedSessions
          ? `密码已更新，并退出了 ${result.data.revokedSessions} 个其他会话`
          : "密码已更新",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "密码修改失败");
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <SettingsPage title="账户" description="管理你的个人资料与登录邮箱。">
      <SettingsSection title="个人资料" description="其他成员会在 Issue、评论和项目中看到这些信息。">
        <FormBody>
          <div className="flex items-center gap-3 rounded-lg bg-surface-subtle p-3">
            <Avatar name={name || data.currentUser.name} src={data.currentUser.avatarUrl} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name || "未命名成员"}</p>
              <p className="truncate text-xs text-tertiary">{email}</p>
            </div>
            <Badge className="ml-auto" variant="neutral" size="xs">
              {roleLabel(data.currentMembership.role)}
            </Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="姓名" required>
              <NativeInput value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
            </Field>
            <Field label="登录邮箱" required>
              <NativeInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            </Field>
          </div>
        </FormBody>
        <FormFooter>
          <Button variant="primary" size="sm" loading={saving} disabled={!name.trim() || !email.trim()} onClick={() => void save()}>
            保存更改
          </Button>
        </FormFooter>
      </SettingsSection>
      <SettingsSection title="修改密码" description="更新后会保留当前设备，并立即退出其他所有登录会话。">
        <FormBody>
          <Field label="当前密码" required>
            <NativeInput type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="新密码" hint="至少 8 个字符" required>
              <NativeInput type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="确认新密码" required>
              <NativeInput type="password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
            </Field>
          </div>
        </FormBody>
        <FormFooter>
          <Button variant="primary" size="sm" loading={passwordSaving} disabled={!currentPassword || newPassword.length < 8 || !confirmPassword} onClick={() => void changePassword()}>
            更新密码
          </Button>
        </FormFooter>
      </SettingsSection>
    </SettingsPage>
  );
}

export function WorkspaceSettings() {
  const { data, mutate } = useWorkspace();
  const [name, setName] = useState(data.workspace.name);
  const [slug, setSlug] = useState(data.workspace.slug);
  const [icon, setIcon] = useState(data.workspace.icon);
  const [timezone, setTimezone] = useState(data.workspace.timezone);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await mutate(
      "workspace.update",
      {
        workspaceId: data.workspace.id,
        changes: {
          name: name.trim(),
          slug: slug.trim().toLocaleLowerCase(),
          icon: icon.trim(),
          timezone: timezone.trim(),
        },
      },
      { successMessage: "工作区设置已更新" },
    );
    setSaving(false);
  }

  return (
    <SettingsPage title="工作区" description="设置整个组织使用的名称、地址和默认时区。">
      <SettingsSection title="基本信息" description="修改地址后，工作区的访问链接也会改变。">
        <FormBody>
          <div className="grid gap-4 sm:grid-cols-[88px_1fr]">
            <Field label="图标">
              <NativeInput value={icon} maxLength={8} onChange={(event) => setIcon(event.target.value)} aria-label="工作区图标" />
            </Field>
            <Field label="工作区名称" required>
              <NativeInput value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="工作区地址" hint="小写字母、数字与连字符" required>
              <NativeInput value={slug} pattern="[a-z0-9-]+" onChange={(event) => setSlug(event.target.value.replace(/[^a-zA-Z0-9-]/g, "").toLocaleLowerCase())} />
            </Field>
            <Field label="默认时区" required>
              <NativeInput value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Shanghai" />
            </Field>
          </div>
        </FormBody>
        <FormFooter>
          <Button variant="primary" size="sm" loading={saving} disabled={!name.trim() || !slug.trim() || !timezone.trim()} onClick={() => void save()}>
            保存更改
          </Button>
        </FormFooter>
      </SettingsSection>
    </SettingsPage>
  );
}

interface NotificationDraft {
  assigned: boolean;
  mentioned: boolean;
  subscribed: boolean;
  projectUpdates: boolean;
}

export function NotificationSettings() {
  const { data, mutate } = useWorkspace();
  const [preferences, setPreferences] = useState<NotificationDraft>(data.notificationPreferences);
  const [saving, setSaving] = useState(false);
  const unread = data.notifications.filter((notification) => !notification.readAt).length;

  function update(key: keyof NotificationDraft, value: boolean) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    await mutate(
      "notificationPreferences.update",
      { preferences },
      { successMessage: "通知偏好已保存" },
    );
    setSaving(false);
  }

  return (
    <SettingsPage title="通知" description="选择哪些工作变化需要进入你的站内 Inbox。">
      <SettingsSection
        title="收件箱通知"
        description={`当前有 ${unread} 条未读通知。`}
        action={<Badge variant={unread ? "accent" : "neutral"} size="xs" icon={<Bell size={10} />}>{unread} 未读</Badge>}
      >
        <div className={dividerClassName}>
          <SwitchRow title="分配给我的 Issue" description="当 Issue 分配给你或从你名下移除时通知。" checked={preferences.assigned} onChange={(value) => update("assigned", value)} />
          <SwitchRow title="提及与回复" description="在评论或描述中提及你，以及回复你的评论时通知。" checked={preferences.mentioned} onChange={(value) => update("mentioned", value)} />
          <SwitchRow title="订阅的 Issue" description="你订阅的 Issue 有状态、负责人或评论变化时通知。" checked={preferences.subscribed} onChange={(value) => update("subscribed", value)} />
          <SwitchRow title="项目更新" description="关注项目发布更新或健康状态改变时通知。" checked={preferences.projectUpdates} onChange={(value) => update("projectUpdates", value)} />
        </div>
      </SettingsSection>
      <SettingsSection title="保存设置" description="邮件和摘要通道不在当前基础版本中，所有已启用事件只进入站内 Inbox。">
        <FormFooter>
          <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>保存偏好</Button>
        </FormFooter>
      </SettingsSection>
    </SettingsPage>
  );
}

type Theme = "light" | "dark" | "system";

export function AppearanceSettings() {
  const { preferences, setPreferences, mutate } = useWorkspace();
  const [theme, setTheme] = useState<Theme>("system");
  const [saving, setSaving] = useState(false);

  function chooseTheme(next: Theme) {
    setTheme(next);
    if (typeof document !== "undefined") {
      const dark = next === "dark" || (next === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
      localStorage.setItem("orbit-theme", next);
    }
  }

  async function save() {
    setSaving(true);
    await mutate(
      "account.update",
      { changes: { theme, compactRows: preferences.compactRows } },
      { successMessage: "外观偏好已保存" },
    );
    setSaving(false);
  }

  return (
    <SettingsPage title="外观" description="调整界面主题和信息密度；本机上的更改会立即预览。">
      <SettingsSection title="主题" description="选择适合当前环境的显示方式。">
        <div className="grid gap-2 p-4 sm:grid-cols-3 sm:p-5">
          {([
            ["light", "浅色", Sun],
            ["dark", "深色", Moon],
            ["system", "跟随系统", Laptop],
          ] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={theme === value}
              onClick={() => chooseTheme(value)}
              className={cn(
                "relative flex h-24 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface text-xs text-secondary transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                theme === value && "border-accent bg-accent-soft text-primary",
              )}
            >
              <Icon size={19} />
              {label}
              {theme === value ? <Check className="absolute right-2 top-2 text-accent" size={13} /> : null}
            </button>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection title="密度">
        <SwitchRow
          title="紧凑 Issue 行"
          description="减少列表行高，在同一屏幕内显示更多 Issue。"
          checked={preferences.compactRows}
          onChange={(compactRows) => setPreferences({ compactRows })}
        />
        <FormFooter>
          <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>保存偏好</Button>
        </FormFooter>
      </SettingsSection>
    </SettingsPage>
  );
}

function roleLabel(role: "admin" | "member" | "guest") {
  return role === "admin" ? "管理员" : role === "member" ? "成员" : "访客";
}
