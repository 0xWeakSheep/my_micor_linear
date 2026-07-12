"use client";

import { useRef, useState } from "react";
import { Clipboard, Download, KeyRound, Plus, Trash2, Upload, Webhook as WebhookIcon } from "lucide-react";
import type { ApiKeySummary, Webhook } from "@/lib/domain";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";
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
  SettingsPage,
  SettingsSection,
  dividerClassName,
} from "./settings-ui";

export function ApiSettings() {
  const { data, mutate } = useWorkspace();
  const [keyName, setKeyName] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [webhookName, setWebhookName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["issue.created", "issue.updated"]);
  const [creatingWebhook, setCreatingWebhook] = useState(false);
  const [revealedWebhookSecret, setRevealedWebhookSecret] = useState<string | null>(null);

  async function createKey() {
    if (!keyName.trim()) return;
    setCreatingKey(true);
    const created = await mutate<{ token?: string; key?: string; secret?: string }>(
      "apiKey.create",
      { name: keyName.trim() },
      { successMessage: "API Key 已创建" },
    );
    setCreatingKey(false);
    if (created) {
      setKeyName("");
      setRevealedKey(created.token ?? created.key ?? created.secret ?? null);
    }
  }

  async function createWebhook() {
    if (!webhookName.trim() || !webhookUrl.trim() || !events.length) return;
    setCreatingWebhook(true);
    const created = await mutate<{ webhook: Webhook; secret: string }>(
      "webhook.create",
      { name: webhookName.trim(), url: webhookUrl.trim(), events, isActive: true },
      { successMessage: "Webhook 已创建" },
    );
    setCreatingWebhook(false);
    if (created) {
      setWebhookName("");
      setWebhookUrl("");
      setRevealedWebhookSecret(created.secret);
    }
  }

  return (
    <SettingsPage title="API 与 Webhooks" description="为内部工具创建 API 凭证，并将事件推送到外部系统。">
      <SettingsSection title="个人 API Keys" description="Key 继承你的权限；完整密钥只在创建时显示一次。">
        <FormBody className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end sm:space-y-0">
          <Field label="Key 名称"><NativeInput value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="CI 集成" /></Field>
          <Button variant="primary" size="md" loading={creatingKey} disabled={!keyName.trim()} startIcon={<Plus size={14} />} onClick={() => void createKey()}>创建 Key</Button>
        </FormBody>
        {revealedKey ? (
          <div className="border-t border-border bg-[var(--warning-soft)] px-4 py-3 sm:px-5">
            <p className="text-xs font-medium text-warning">请立即复制，关闭后将无法再次查看。</p>
            <div className="mt-2 flex gap-2"><code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-surface px-2.5 py-2 text-xs">{revealedKey}</code><IconButton label="复制 API Key" icon={<Clipboard size={14} />} variant="secondary" onClick={() => void navigator.clipboard.writeText(revealedKey)} /></div>
          </div>
        ) : null}
        {data.apiKeys.length ? <div className={`${dividerClassName} border-t border-border`}>{data.apiKeys.map((apiKey) => <ApiKeyRow key={apiKey.id} apiKey={apiKey} />)}</div> : <EmptyRows icon={<KeyRound size={16} />} title="暂无 API Key" description="创建 Key 后可用于调用工作区 API。" />}
      </SettingsSection>

      <SettingsSection title="Webhooks" description="向 HTTPS 端点发送所选工作区事件。">
        <FormBody>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="名称"><NativeInput value={webhookName} onChange={(event) => setWebhookName(event.target.value)} placeholder="数据仓库" /></Field><Field label="端点 URL"><NativeInput type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://example.com/webhooks/micro-linear" /></Field></div>
          <EventPicker events={events} onChange={setEvents} />
        </FormBody>
        <FormFooter><Button variant="primary" size="sm" loading={creatingWebhook} disabled={!webhookName.trim() || !webhookUrl.trim() || !events.length} onClick={() => void createWebhook()}>创建 Webhook</Button></FormFooter>
        {revealedWebhookSecret ? (
          <div className="border-t border-border bg-[var(--warning-soft)] px-4 py-3 sm:px-5">
            <p className="text-xs font-medium text-warning">签名密钥只显示一次，请立即复制并用于校验 X-Micro-Linear-Signature。</p>
            <div className="mt-2 flex gap-2"><code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-surface px-2.5 py-2 text-xs">{revealedWebhookSecret}</code><IconButton label="复制 Webhook 签名密钥" icon={<Clipboard size={14} />} variant="secondary" onClick={() => void navigator.clipboard.writeText(revealedWebhookSecret)} /></div>
          </div>
        ) : null}
        {data.webhooks.length ? <div className={`${dividerClassName} border-t border-border`}>{data.webhooks.map((webhook) => <WebhookRow key={webhook.id} webhook={webhook} />)}</div> : <EmptyRows icon={<WebhookIcon size={16} />} title="暂无 Webhook" description="添加端点后，工作区事件会实时推送到你的系统。" />}
      </SettingsSection>
    </SettingsPage>
  );
}

function ApiKeyRow({ apiKey }: { apiKey: ApiKeySummary }) {
  const { mutate } = useWorkspace();
  const [revoking, setRevoking] = useState(false);
  async function revoke() {
    if (!window.confirm(`撤销 API Key“${apiKey.name}”？使用它的集成会立即失效。`)) return;
    setRevoking(true);
    await mutate("apiKey.revoke", { apiKeyId: apiKey.id }, { successMessage: "API Key 已撤销" });
    setRevoking(false);
  }
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-subtle text-tertiary"><KeyRound size={14} /></span>
      <div className="min-w-0"><p className="truncate text-sm font-medium">{apiKey.name}</p><p className="truncate font-mono text-[11px] text-tertiary">{apiKey.prefix}•••• · {apiKey.lastUsedAt ? `上次使用 ${formatDate(apiKey.lastUsedAt)}` : "从未使用"}</p></div>
      <Button className="ml-auto" variant="ghost" size="sm" loading={revoking} onClick={() => void revoke()}>撤销</Button>
    </div>
  );
}

function WebhookRow({ webhook }: { webhook: Webhook }) {
  const { mutate } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: webhook.name, url: webhook.url, events: webhook.events, isActive: webhook.isActive });
  const [saving, setSaving] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  async function save() {
    setSaving(true);
    const result = await mutate("webhook.update", { webhookId: webhook.id, changes: draft }, { successMessage: "Webhook 已更新" });
    setSaving(false);
    if (result) setEditing(false);
  }
  async function remove() {
    if (!window.confirm(`删除 Webhook“${webhook.name}”？`)) return;
    setSaving(true);
    await mutate("webhook.delete", { webhookId: webhook.id }, { successMessage: "Webhook 已删除" });
    setSaving(false);
  }
  async function rotateSecret() {
    if (!window.confirm(`轮换 Webhook“${webhook.name}”的签名密钥？旧密钥会立即失效。`)) return;
    setSaving(true);
    const result = await mutate<{ webhook: Webhook; secret: string }>(
      "webhook.update",
      { webhookId: webhook.id, changes: { rotateSecret: true } },
      { successMessage: "Webhook 签名密钥已轮换" },
    );
    setSaving(false);
    if (result?.secret) setRevealedSecret(result.secret);
  }
  if (editing) {
    return (
      <div className="space-y-3 bg-surface-subtle p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2"><Field label="名称"><NativeInput value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></Field><Field label="URL"><NativeInput type="url" value={draft.url} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} /></Field></div>
        <EventPicker events={draft.events} onChange={(events) => setDraft((current) => ({ ...current, events }))} />
        <label className="flex items-center gap-2 text-xs text-secondary"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} className="size-4 accent-[var(--accent)]" />启用 Webhook</label>
        <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setEditing(false)}>取消</Button><Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>保存</Button></div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-subtle text-tertiary"><WebhookIcon size={14} /></span>
      <div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-medium">{webhook.name}</p><Badge variant={webhook.isActive ? "success" : "neutral"} size="xs">{webhook.isActive ? "启用" : "停用"}</Badge></div><p className="truncate text-xs text-tertiary">{webhook.url} · {webhook.events.length} 个事件</p></div>
      <div className="ml-auto flex items-center gap-1"><Button variant="ghost" size="sm" loading={saving} onClick={() => void rotateSecret()}>轮换密钥</Button><Button variant="ghost" size="sm" onClick={() => setEditing(true)}>编辑</Button><IconButton label={`删除 ${webhook.name}`} icon={<Trash2 size={13} />} variant="ghost" size="icon-sm" className="hover:text-danger" disabled={saving} onClick={() => void remove()} /></div>
      {revealedSecret ? <div className="basis-full rounded-md border border-warning/30 bg-[var(--warning-soft)] p-2 text-[11px]"><p className="font-medium text-warning">新签名密钥只显示一次</p><div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 overflow-x-auto">{revealedSecret}</code><IconButton label="复制新签名密钥" icon={<Clipboard size={13} />} size="icon-sm" onClick={() => void navigator.clipboard.writeText(revealedSecret)} /></div></div> : null}
    </div>
  );
}

function EventPicker({ events, onChange }: { events: string[]; onChange: (events: string[]) => void }) {
  return (
    <fieldset><legend className="text-[11px] font-medium text-secondary">订阅事件</legend><div className="mt-1.5 flex flex-wrap gap-2">{WEBHOOK_EVENTS.map((eventName) => { const checked = events.includes(eventName); return <label key={eventName} className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-[10px] text-secondary hover:border-border-strong"><input type="checkbox" checked={checked} onChange={() => onChange(checked ? events.filter((value) => value !== eventName) : [...events, eventName])} className="size-3.5 accent-[var(--accent)]" />{eventName}</label>; })}</div></fieldset>
  );
}

type DataFormat = "json" | "csv";
interface ExportResult { content?: string; data?: string; filename?: string; mime?: string }

export function ImportExportSettings() {
  const { data, mutate } = useWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);
  const [format, setFormat] = useState<DataFormat>("json");
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function importData() {
    if (!file) return;
    setImporting(true);
    const content = await file.text();
    const detectedFormat: DataFormat = file.name.toLocaleLowerCase().endsWith(".csv") ? "csv" : "json";
    const result = await mutate("data.import", { format: detectedFormat, filename: file.name, content }, { successMessage: "数据导入完成" });
    setImporting(false);
    if (result) {
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function exportData() {
    setExporting(true);
    const result = await mutate<ExportResult>("data.export", { format, scope: "workspace" }, { refresh: false, successMessage: "导出文件已生成" });
    setExporting(false);
    const content = result?.content ?? result?.data;
    if (!content) return;
    const blob = new Blob([content], { type: result?.mime ?? (format === "json" ? "application/json" : "text/csv") });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result?.filename ?? `${data.workspace.slug}-export.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <SettingsPage title="导入与导出" description="迁移 Issue 数据，或为备份和分析导出整个工作区。">
      <SettingsSection title="导入数据" description="支持本应用导出的 JSON，或包含 Issue 字段的 CSV。">
        <FormBody>
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-surface-subtle px-4 text-center transition-colors hover:bg-surface-hover focus-within:ring-2 focus-within:ring-accent">
            <Upload size={18} className="text-tertiary" />
            <span className="mt-2 text-sm font-medium">{file ? file.name : "选择 JSON 或 CSV 文件"}</span>
            <span className="mt-1 text-xs text-tertiary">导入前会校验字段；现有数据不会被自动删除。</span>
            <input ref={fileRef} type="file" accept=".json,.csv,application/json,text/csv" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
        </FormBody>
        <FormFooter><Button variant="primary" size="sm" loading={importing} disabled={!file} startIcon={<Upload size={14} />} onClick={() => void importData()}>开始导入</Button></FormFooter>
      </SettingsSection>
      <SettingsSection title="导出工作区" description={`包括 ${data.issues.length} 个 Issue、${data.projects.length} 个项目及相关配置。`}>
        <FormBody className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-end sm:space-y-0">
          <Field label="文件格式"><NativeSelect value={format} onChange={(event) => setFormat(event.target.value as DataFormat)}><option value="json">JSON（完整备份）</option><option value="csv">CSV（Issue 列表）</option></NativeSelect></Field>
          <p className="text-xs leading-5 text-tertiary">导出不会包含 API Key 明文、登录凭证或已删除的数据。</p>
        </FormBody>
        <FormFooter><Button variant="primary" size="sm" loading={exporting} startIcon={<Download size={14} />} onClick={() => void exportData()}>导出数据</Button></FormFooter>
      </SettingsSection>
    </SettingsPage>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}
