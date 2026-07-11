"use client";

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import {
  Activity as ActivityIcon,
  Archive,
  Bell,
  BellOff,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  Link2,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  RotateCcw,
  Send,
  SmilePlus,
  Target,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import { formatDistanceToNowStrict, format } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { ActionResult, Attachment, Comment, Issue, IssueRelationType } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { PriorityIcon, StateIcon, UserAvatar } from "./issue-glyphs";

export function IssueDetailDialog() {
  const { data, selectedIssueId, setSelectedIssueId, updateIssue, mutate, refresh } = useWorkspace();
  const issue = data.issues.find((item) => item.id === selectedIssueId);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [comment, setComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [relationType, setRelationType] = useState<IssueRelationType>("related");
  const [relationTargetId, setRelationTargetId] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const attachmentInput = useRef<HTMLInputElement>(null);

  const issueComments = useMemo(
    () => data.comments.filter((item) => item.issueId === issue?.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [data.comments, issue?.id],
  );
  const activities = useMemo(
    () => data.activities.filter((item) => item.entityId === issue?.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [data.activities, issue?.id],
  );
  const issueAttachments = useMemo(
    () => data.attachments.filter((item) => item.issueId === issue?.id),
    [data.attachments, issue?.id],
  );
  const issueRelations = useMemo(
    () => data.relations.filter((item) => item.issueId === issue?.id || item.relatedIssueId === issue?.id),
    [data.relations, issue?.id],
  );

  if (!issue) return null;

  const state = data.states.find((item) => item.id === issue.statusId);
  const team = data.teams.find((item) => item.id === issue.teamId);
  const assignee = data.memberships.find((item) => item.userId === issue.assigneeId);
  const creator = data.memberships.find((item) => item.userId === issue.creatorId);
  const project = data.projects.find((item) => item.id === issue.projectId);
  const childIssues = data.issues.filter((item) => item.parentId === issue.id && !item.trashedAt);
  const subscribed = issue.subscriberIds.includes(data.currentUser.id);
  const issueId = issue.id;
  const issueTeamId = issue.teamId;
  const relationCandidates = data.issues.filter((item) => item.id !== issue.id && !item.trashedAt);
  const replyTarget = replyTo ? issueComments.find((item) => item.id === replyTo) : null;
  const replyAuthor = replyTarget
    ? data.memberships.find((member) => member.userId === replyTarget.authorId)?.user
    : null;
  const inTriage = issue.triageStatus === "pending" || issue.triageStatus === "snoozed" || state?.type === "triage";

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return;
    setSending(true);
    const result = await mutate("comment.create", { issueId, body: comment.trim(), parentId: replyTo }, { successMessage: "评论已发布" });
    setSending(false);
    if (result) {
      setComment("");
      setReplyTo(null);
    }
  }

  async function addRelation() {
    if (!relationTargetId) return;
    const result = await mutate(
      "issueRelation.create",
      { issueId, relatedIssueId: relationTargetId, type: relationType },
      { successMessage: "Issue 关系已添加" },
    );
    if (result) setRelationTargetId("");
  }

  async function acceptTriage() {
    const nextState = data.states
      .filter((item) => item.teamId === issueTeamId && item.type === "unstarted")
      .toSorted((left, right) => left.position - right.position)[0];
    if (nextState) await updateIssue(issueId, { statusId: nextState.id, triageStatus: "accepted", snoozedUntil: null });
  }

  async function declineTriage() {
    const canceled = data.states
      .filter((item) => item.teamId === issueTeamId && item.type === "canceled")
      .toSorted((left, right) => left.position - right.position)[0];
    if (canceled) await updateIssue(issueId, { statusId: canceled.id, triageStatus: "declined", snoozedUntil: null });
  }

  async function snoozeTriage() {
    const until = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    await updateIssue(issueId, { triageStatus: "snoozed", snoozedUntil: until });
  }

  async function uploadAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setUploadingAttachment(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("issueId", issueId);
      const response = await fetch(`/api/workspaces/${encodeURIComponent(data.workspace.slug)}/attachments`, {
        method: "POST",
        body: form,
      });
      const result = await response.json() as ActionResult<Attachment>;
      if (!response.ok || !result.ok) throw new Error(result.error ?? "附件上传失败");
      await refresh();
      toast.success("附件已上传");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "附件上传失败");
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function deleteAttachment(attachment: Attachment) {
    try {
      const response = await fetch(attachment.url, { method: "DELETE" });
      const result = await response.json() as ActionResult<boolean>;
      if (!response.ok || !result.ok) throw new Error(result.error ?? "附件删除失败");
      await refresh();
      toast.success("附件已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "附件删除失败");
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && setSelectedIssueId(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--overlay)] backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex h-[min(860px,calc(100dvh-32px))] w-[min(1120px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border-strong bg-surface shadow-[var(--shadow-dialog)] outline-none max-md:h-dvh max-md:w-screen max-md:rounded-none max-md:border-0"
          aria-describedby="issue-detail-description"
        >
          <Dialog.Title className="sr-only">{issue.identifier} {issue.title}</Dialog.Title>
          <Dialog.Description id="issue-detail-description" className="sr-only">Issue 详情、属性、活动与评论。</Dialog.Description>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
              <span className="grid size-5 place-items-center rounded-[5px] text-[9px] font-bold text-white" style={{ background: team?.color }}>{team?.key.slice(0, 1)}</span>
              <span className="ml-1 font-mono text-[11px] text-tertiary">{issue.identifier}</span>
              <button type="button" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/${data.workspace.slug}/issue/${issue.identifier}`)} className="grid size-7 place-items-center rounded text-tertiary transition-colors hover:bg-surface-hover hover:text-primary" aria-label="复制 Issue 链接"><Copy size={13} /></button>
              <button type="button" onClick={() => void mutate("issue.subscribe", { issueId: issue.id, subscribe: !subscribed }, { successMessage: subscribed ? "已取消订阅" : "已订阅" })} className="ml-auto grid size-7 place-items-center rounded text-tertiary transition-colors hover:bg-surface-hover hover:text-primary" aria-label={subscribed ? "取消订阅" : "订阅"}>{subscribed ? <Bell size={14} /> : <BellOff size={14} />}</button>
              <button type="button" className="grid size-7 place-items-center rounded text-tertiary transition-colors hover:bg-surface-hover hover:text-primary" aria-label="更多操作"><MoreHorizontal size={15} /></button>
              <Dialog.Close asChild><button type="button" className="grid size-7 place-items-center rounded text-tertiary transition-colors hover:bg-surface-hover hover:text-primary" aria-label="关闭"><X size={16} /></button></Dialog.Close>
            </header>

            <main className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[780px] px-6 py-7 sm:px-10">
                {editingTitle ? (
                  <textarea
                    autoFocus
                    rows={2}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    onBlur={() => {
                      setEditingTitle(false);
                      if (title.trim() && title.trim() !== issue.title) void updateIssue(issue.id, { title: title.trim() });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    className="w-full resize-none border-0 bg-transparent text-[28px] font-semibold leading-[1.2] tracking-[-0.035em] outline-none"
                  />
                ) : (
                  <button type="button" onClick={() => { setTitle(issue.title); setEditingTitle(true); }} className="block w-full text-left text-[28px] font-semibold leading-[1.2] tracking-[-0.035em] outline-none hover:text-secondary">
                    {issue.title}
                  </button>
                )}

                {inTriage ? (
                  <div className="mt-5 flex flex-wrap items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--warning)_32%,var(--border))] bg-[var(--warning-soft)] px-3 py-2.5">
                    <span className="mr-auto text-xs font-medium text-warning">
                      {issue.triageStatus === "snoozed" ? "已推迟的 Triage Issue" : "等待 Triage"}
                    </span>
                    <button type="button" onClick={() => void acceptTriage()} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-success px-2.5 text-[11px] font-medium text-white hover:opacity-90">
                      <CheckCircle2 size={12} /> 接受
                    </button>
                    <button type="button" onClick={() => void snoozeTriage()} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[11px] text-secondary hover:bg-surface-hover">
                      <Clock3 size={12} /> 推迟一天
                    </button>
                    <button type="button" onClick={() => void declineTriage()} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[11px] text-danger hover:bg-[var(--danger-soft)]">
                      <X size={12} /> 拒绝
                    </button>
                  </div>
                ) : null}

                <div className="mt-5 min-h-24 text-sm leading-6 text-secondary">
                  {editingDescription ? (
                    <textarea
                      autoFocus
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      onBlur={() => {
                        setEditingDescription(false);
                        if (description !== issue.description) void updateIssue(issue.id, { description });
                      }}
                      className="min-h-44 w-full resize-y rounded-md border border-border bg-surface-subtle p-3 outline-none focus:border-accent"
                      placeholder="添加描述… 支持 Markdown"
                    />
                  ) : (
                    <button type="button" onClick={() => { setDescription(issue.description); setEditingDescription(true); }} className="min-h-20 w-full rounded-md px-1 py-1 text-left outline-none hover:bg-surface-subtle">
                      {issue.description ? (
                        <div className="prose prose-sm max-w-none text-secondary prose-headings:text-primary prose-strong:text-primary dark:prose-invert"><ReactMarkdown>{issue.description}</ReactMarkdown></div>
                      ) : (
                        <span className="text-tertiary">添加描述…</span>
                      )}
                    </button>
                  )}
                </div>

                <details className="mt-5 rounded-lg border border-border bg-panel md:hidden">
                  <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-primary">Issue 属性</summary>
                  <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
                    <MobileProperty label="团队">
                      <select value={issue.teamId} onChange={(event) => void updateIssue(issue.id, { teamId: event.target.value })}>
                        {data.teams.map((item) => <option key={item.id} value={item.id}>{item.key} · {item.name}</option>)}
                      </select>
                    </MobileProperty>
                    <MobileProperty label="状态">
                      <select value={issue.statusId} onChange={(event) => void updateIssue(issue.id, { statusId: event.target.value })}>
                        {data.states.filter((item) => item.teamId === issue.teamId).toSorted((a, b) => a.position - b.position).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </MobileProperty>
                    <MobileProperty label="优先级">
                      <select value={issue.priority} onChange={(event) => void updateIssue(issue.id, { priority: Number(event.target.value) as Issue["priority"] })}>
                        <option value={0}>无优先级</option><option value={1}>紧急</option><option value={2}>高</option><option value={3}>中</option><option value={4}>低</option>
                      </select>
                    </MobileProperty>
                    <MobileProperty label="负责人">
                      <select value={issue.assigneeId ?? ""} onChange={(event) => void updateIssue(issue.id, { assigneeId: event.target.value || null })}>
                        <option value="">未分配</option>{data.memberships.map((member) => <option key={member.userId} value={member.userId}>{member.user.name}</option>)}
                      </select>
                    </MobileProperty>
                    <MobileProperty label="项目">
                      <select value={issue.projectId ?? ""} onChange={(event) => void updateIssue(issue.id, { projectId: event.target.value || null })}>
                        <option value="">无项目</option>{data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </MobileProperty>
                    <MobileProperty label="周期">
                      <select value={issue.cycleId ?? ""} onChange={(event) => void updateIssue(issue.id, { cycleId: event.target.value || null })}>
                        <option value="">无周期</option>{data.cycles.filter((item) => item.teamId === issue.teamId).map((item) => <option key={item.id} value={item.id}>Cycle {item.number}</option>)}
                      </select>
                    </MobileProperty>
                    <MobileProperty label="截止日期">
                      <input type="date" value={issue.dueDate ?? ""} onChange={(event) => void updateIssue(issue.id, { dueDate: event.target.value || null })} />
                    </MobileProperty>
                  </div>
                </details>

                <section className="mt-7">
                  <div className="mb-2 flex items-center gap-2">
                    <Link2 size={13} className="text-tertiary" />
                    <h2 className="text-xs font-medium text-secondary">Issue 关系</h2>
                    <span className="text-[11px] text-tertiary">{issueRelations.length}</span>
                  </div>
                  <div className="overflow-hidden rounded-md border border-border">
                    {issueRelations.map((relation) => {
                      const outgoing = relation.issueId === issue.id;
                      const otherId = outgoing ? relation.relatedIssueId : relation.issueId;
                      const relatedIssue = data.issues.find((item) => item.id === otherId);
                      if (!relatedIssue) return null;
                      return (
                        <div key={relation.id} className="flex min-h-10 items-center gap-2 border-b border-border px-3 text-xs last:border-0">
                          <span className="w-16 shrink-0 text-[10px] text-tertiary">{relationLabel(relation.type, outgoing)}</span>
                          <button type="button" onClick={() => setSelectedIssueId(relatedIssue.id)} className="min-w-0 flex-1 truncate text-left text-primary hover:underline">
                            <span className="mr-2 font-mono text-[10px] text-tertiary">{relatedIssue.identifier}</span>{relatedIssue.title}
                          </button>
                          <button type="button" onClick={() => void mutate("issueRelation.delete", { relationId: relation.id }, { successMessage: "Issue 关系已移除" })} className="grid size-7 shrink-0 place-items-center rounded text-tertiary hover:bg-surface-hover hover:text-danger" aria-label={`移除与 ${relatedIssue.identifier} 的关系`}>
                            <Unlink size={13} />
                          </button>
                        </div>
                      );
                    })}
                    <div className="flex flex-wrap items-center gap-2 bg-surface-subtle p-2">
                      <select value={relationType} onChange={(event) => setRelationType(event.target.value as IssueRelationType)} className="h-8 rounded-md border border-border bg-surface px-2 text-[11px] outline-none focus:border-accent" aria-label="关系类型">
                        <option value="related">相关</option>
                        <option value="blocks">阻塞</option>
                        <option value="duplicate">重复于</option>
                      </select>
                      <select value={relationTargetId} onChange={(event) => setRelationTargetId(event.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-[11px] outline-none focus:border-accent" aria-label="关联 Issue">
                        <option value="">选择 Issue…</option>
                        {relationCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.identifier} · {candidate.title}</option>)}
                      </select>
                      <button type="button" onClick={() => void addRelation()} disabled={!relationTargetId} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[11px] text-secondary hover:bg-surface-hover hover:text-primary disabled:opacity-50">
                        <Plus size={12} /> 添加
                      </button>
                    </div>
                  </div>
                </section>

                <section className="mt-7">
                  <div className="mb-2 flex items-center gap-2">
                    <h2 className="text-xs font-medium text-secondary">附件</h2>
                    <span className="text-[11px] text-tertiary">{issueAttachments.length}</span>
                    <button
                      type="button"
                      onClick={() => attachmentInput.current?.click()}
                      disabled={uploadingAttachment}
                      className="ml-auto grid size-7 place-items-center rounded text-tertiary hover:bg-surface-hover hover:text-primary disabled:opacity-50"
                      aria-label="上传附件"
                    >
                      {uploadingAttachment ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    </button>
                    <input
                      ref={attachmentInput}
                      type="file"
                      className="sr-only"
                      onChange={uploadAttachment}
                      aria-label="选择附件文件"
                    />
                  </div>
                  <div className="overflow-hidden rounded-md border border-border">
                    {issueAttachments.length ? issueAttachments.map((attachment) => (
                      <div key={attachment.id} className="flex min-h-10 items-center gap-2 border-b border-border px-3 text-xs last:border-0">
                        <Paperclip size={13} className="shrink-0 text-tertiary" />
                        <a href={attachment.url} className="min-w-0 flex-1 truncate text-primary hover:underline" title={attachment.name}>
                          {attachment.name}
                        </a>
                        <span className="shrink-0 text-[10px] text-tertiary">{formatFileSize(attachment.size)}</span>
                        <a href={attachment.url} className="grid size-7 shrink-0 place-items-center rounded text-tertiary hover:bg-surface-hover hover:text-primary" aria-label={`下载 ${attachment.name}`}>
                          <Download size={13} />
                        </a>
                        {(attachment.userId === data.currentUser.id || data.currentMembership.role === "admin") ? (
                          <button type="button" onClick={() => void deleteAttachment(attachment)} className="grid size-7 shrink-0 place-items-center rounded text-tertiary hover:bg-[var(--danger-soft)] hover:text-danger" aria-label={`删除 ${attachment.name}`}>
                            <Trash2 size={13} />
                          </button>
                        ) : null}
                      </div>
                    )) : <div className="px-3 py-3 text-xs text-tertiary">上传设计稿、日志或其他相关文件，单个文件不超过 25 MB。</div>}
                  </div>
                </section>

                <section className="mt-7">
                  <div className="mb-2 flex items-center gap-2">
                    <h2 className="text-xs font-medium text-secondary">子 Issue</h2>
                    <span className="text-[11px] text-tertiary">{childIssues.length}</span>
                    <button type="button" onClick={() => void mutate("issue.create", { teamId: issue.teamId, statusId: issue.statusId, title: "新子 Issue", parentId: issue.id })} className="ml-auto grid size-7 place-items-center rounded text-tertiary hover:bg-surface-hover hover:text-primary" aria-label="添加子 Issue"><Plus size={14} /></button>
                  </div>
                  <div className="overflow-hidden rounded-md border border-border">
                    {childIssues.length ? childIssues.map((child) => (
                      <button key={child.id} type="button" onClick={() => setSelectedIssueId(child.id)} className="flex h-9 w-full items-center gap-2 border-b border-border px-3 text-left text-xs transition-colors last:border-0 hover:bg-surface-hover">
                        <StateIcon state={data.states.find((item) => item.id === child.statusId)} size={13} />
                        <span className="font-mono text-[10px] text-tertiary">{child.identifier}</span>
                        <span className="truncate">{child.title}</span>
                      </button>
                    )) : <div className="px-3 py-3 text-xs text-tertiary">把工作拆成更小、可独立完成的 Issue。</div>}
                  </div>
                </section>

                <section className="mt-8 border-t border-border pt-6">
                  <h2 className="mb-5 flex items-center gap-2 text-xs font-medium text-secondary"><ActivityIcon size={14} /> 活动</h2>
                  <div className="space-y-5">
                    <TimelineEvent avatar={creator?.user} date={issue.createdAt}>
                      <span className="font-medium text-primary">{creator?.user.name ?? "未知用户"}</span> 创建了这个 Issue
                    </TimelineEvent>
                    {[...activities.map((activity) => ({ type: "activity" as const, value: activity })), ...issueComments.map((commentItem) => ({ type: "comment" as const, value: commentItem }))]
                      .sort((a, b) => a.value.createdAt.localeCompare(b.value.createdAt))
                      .map((item) => item.type === "comment" ? (
                        <TimelineEvent key={`comment-${item.value.id}`} avatar={data.memberships.find((member) => member.userId === item.value.authorId)?.user} date={item.value.createdAt} card>
                          <CommentCard commentItem={item.value} issueTeamId={issue.teamId} onReply={() => setReplyTo(item.value.id)} />
                        </TimelineEvent>
                      ) : (
                        <TimelineEvent key={`activity-${item.value.id}`} avatar={data.memberships.find((member) => member.userId === item.value.actorId)?.user} date={item.value.createdAt}>
                          <span className="font-medium text-primary">{data.memberships.find((member) => member.userId === item.value.actorId)?.user.name ?? "系统"}</span>{" "}{activityLabel(item.value.action)}
                        </TimelineEvent>
                      ))}
                  </div>
                </section>

                <form onSubmit={submitComment} className="mt-7 rounded-lg border border-border bg-surface-raised p-3 focus-within:border-border-strong">
                  {replyTarget ? (
                    <div className="mb-2 flex items-center gap-2 rounded-md bg-accent-soft px-2.5 py-2 text-[11px] text-secondary">
                      <Reply size={12} className="text-accent" />
                      回复 {replyAuthor?.name ?? "评论"}
                      <button type="button" onClick={() => setReplyTo(null)} className="ml-auto grid size-5 place-items-center rounded text-tertiary hover:bg-surface-hover hover:text-primary" aria-label="取消回复"><X size={11} /></button>
                    </div>
                  ) : null}
                  <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="留下评论… 使用 @邮箱 提及成员" className="min-h-20 w-full resize-y border-0 bg-transparent text-sm outline-none" />
                  <div className="mt-2 flex items-center border-t border-border pt-2">
                    <button type="button" onClick={() => attachmentInput.current?.click()} disabled={uploadingAttachment} className="grid size-7 place-items-center rounded text-tertiary hover:bg-surface-hover hover:text-primary disabled:opacity-50" aria-label="添加附件"><Paperclip size={14} /></button>
                    <span className="ml-1 text-[10px] text-tertiary">支持 Markdown</span>
                    <button type="submit" disabled={sending || !comment.trim()} className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"><Send size={12} /> 发送</button>
                  </div>
                </form>
              </div>
            </main>
          </div>

          <aside className="hidden w-[312px] shrink-0 overflow-y-auto border-l border-border bg-panel p-4 md:block">
            <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-tertiary">属性</h2>
            <PropertyRow label="团队" icon={<span className="size-3 rounded-[3px]" style={{ background: team?.color ?? "var(--surface-active)" }} />}>
              <select aria-label="团队" value={issue.teamId} onChange={(event) => void updateIssue(issue.id, { teamId: event.target.value })} className="w-full bg-transparent text-xs outline-none">
                {data.teams.map((item) => <option key={item.id} value={item.id}>{item.key} · {item.name}</option>)}
              </select>
            </PropertyRow>
            <PropertyRow label="状态" icon={<StateIcon state={state} size={14} />}>
              <select aria-label="状态" value={issue.statusId} onChange={(event) => void updateIssue(issue.id, { statusId: event.target.value })} className="w-full bg-transparent text-xs outline-none">
                {data.states.filter((item) => item.teamId === issue.teamId).sort((a, b) => a.position - b.position).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </PropertyRow>
            <PropertyRow label="优先级" icon={<PriorityIcon priority={issue.priority} size={14} />}>
              <select aria-label="优先级" value={issue.priority} onChange={(event) => void updateIssue(issue.id, { priority: Number(event.target.value) as Issue["priority"] })} className="w-full bg-transparent text-xs outline-none">
                <option value={0}>无优先级</option><option value={1}>紧急</option><option value={2}>高</option><option value={3}>中</option><option value={4}>低</option>
              </select>
            </PropertyRow>
            <PropertyRow label="负责人" icon={<UserAvatar user={assignee?.user} size={16} />}>
              <select aria-label="负责人" value={issue.assigneeId ?? ""} onChange={(event) => void updateIssue(issue.id, { assigneeId: event.target.value || null })} className="w-full bg-transparent text-xs outline-none">
                <option value="">未分配</option>{data.memberships.map((member) => <option key={member.userId} value={member.userId}>{member.user.name}</option>)}
              </select>
            </PropertyRow>
            <PropertyRow label="项目" icon={<span className="size-3 rounded-[3px]" style={{ background: project?.color ?? "var(--surface-active)" }} />}>
              <select aria-label="项目" value={issue.projectId ?? ""} onChange={(event) => void updateIssue(issue.id, { projectId: event.target.value || null })} className="w-full bg-transparent text-xs outline-none">
                <option value="">无项目</option>{data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </PropertyRow>
            <PropertyRow label="里程碑" icon={<Target size={14} className="text-tertiary" />}>
              <select aria-label="里程碑" value={issue.milestoneId ?? ""} disabled={!issue.projectId} onChange={(event) => void updateIssue(issue.id, { milestoneId: event.target.value || null })} className="w-full bg-transparent text-xs outline-none disabled:opacity-50">
                <option value="">{issue.projectId ? "无里程碑" : "先选择项目"}</option>{data.milestones.filter((item) => item.projectId === issue.projectId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </PropertyRow>
            <PropertyRow label="周期" icon={<CalendarDays size={14} className="text-tertiary" />}>
              <select aria-label="周期" value={issue.cycleId ?? ""} onChange={(event) => void updateIssue(issue.id, { cycleId: event.target.value || null })} className="w-full bg-transparent text-xs outline-none">
                <option value="">无周期</option>{data.cycles.filter((item) => item.teamId === issue.teamId).map((item) => <option key={item.id} value={item.id}>Cycle {item.number}</option>)}
              </select>
            </PropertyRow>
            <PropertyRow label="估算" icon={<CheckCircle2 size={14} className="text-tertiary" />}>
              <select aria-label="估算" value={issue.estimate ?? ""} onChange={(event) => void updateIssue(issue.id, { estimate: event.target.value ? Number(event.target.value) : null })} className="w-full bg-transparent text-xs outline-none">
                <option value="">未估算</option>{[1, 2, 3, 5, 8].map((value) => <option key={value} value={value}>{value} points</option>)}
              </select>
            </PropertyRow>
            <PropertyRow label="截止日期" icon={<CalendarDays size={14} className="text-tertiary" />}>
              <input aria-label="截止日期" type="date" value={issue.dueDate ?? ""} onChange={(event) => void updateIssue(issue.id, { dueDate: event.target.value || null })} className="w-full bg-transparent text-xs outline-none" />
            </PropertyRow>

            <div className="my-5 border-t border-border" />
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-tertiary">标签</h2>
            <div className="flex flex-wrap gap-1.5">
              {data.labels.filter((label) => issue.labelIds.includes(label.id)).map((label) => (
                <button key={label.id} type="button" onClick={() => void updateIssue(issue.id, { labelIds: issue.labelIds.filter((id) => id !== label.id) })} className="inline-flex items-center gap-1.5 rounded border border-border bg-surface px-1.5 py-1 text-[10px] text-secondary hover:bg-surface-hover">
                  <span className="size-1.5 rounded-full" style={{ background: label.color }} />{label.name}<X size={9} />
                </button>
              ))}
              <select aria-label="添加标签" value="" onChange={(event) => event.target.value && void updateIssue(issue.id, { labelIds: [...issue.labelIds, event.target.value] })} className="h-6 rounded border border-dashed border-border bg-transparent px-1 text-[10px] text-tertiary outline-none">
                <option value="">+ 添加</option>{data.labels.filter((label) => !issue.labelIds.includes(label.id)).map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
              </select>
            </div>

            <div className="my-5 border-t border-border" />
            <dl className="space-y-2 text-[11px] text-tertiary">
              <div className="flex justify-between"><dt>创建者</dt><dd>{creator?.user.name ?? "未知"}</dd></div>
              <div className="flex justify-between"><dt>创建时间</dt><dd>{format(new Date(issue.createdAt), "yyyy-MM-dd HH:mm")}</dd></div>
              <div className="flex justify-between"><dt>更新时间</dt><dd>{formatDistanceToNowStrict(new Date(issue.updatedAt), { addSuffix: true, locale: zhCN })}</dd></div>
            </dl>
            <div className="mt-5 space-y-1">
              {issue.archivedAt || issue.trashedAt ? (
                <ActionButton icon={<RotateCcw size={13} />} label="恢复到工作区" onClick={() => void mutate("issue.restore", { issueId: issue.id }, { successMessage: "Issue 已恢复" })} />
              ) : (
                <>
                  <ActionButton icon={<Archive size={13} />} label="归档" onClick={() => void mutate("issue.archive", { issueId: issue.id }, { successMessage: "Issue 已归档" })} />
                  <ActionButton icon={<Trash2 size={13} />} label="移到回收站" danger onClick={() => { void mutate("issue.delete", { issueId: issue.id }, { successMessage: "Issue 已移到回收站" }); setSelectedIssueId(null); }} />
                </>
              )}
            </div>
          </aside>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CommentCard({ commentItem, issueTeamId, onReply }: { commentItem: Comment; issueTeamId: string; onReply: () => void }) {
  const { data, mutate } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(commentItem.body);
  const [saving, setSaving] = useState(false);
  const author = data.memberships.find((member) => member.userId === commentItem.authorId)?.user;
  const parent = commentItem.parentId ? data.comments.find((item) => item.id === commentItem.parentId) : null;
  const parentAuthor = parent ? data.memberships.find((member) => member.userId === parent.authorId)?.user : null;
  const canManage = commentItem.authorId === data.currentUser.id || data.currentMembership.role === "admin" || data.teamMembers.some((member) => member.teamId === issueTeamId && member.userId === data.currentUser.id && member.role === "lead");
  const reactions = data.reactions.filter((reaction) => reaction.commentId === commentItem.id);
  const reactionChoices = [...new Set([...reactions.map((reaction) => reaction.emoji), "👍", "🎉", "❤️"])].slice(0, 5);

  async function saveComment() {
    if (!draft.trim() || draft.trim() === commentItem.body) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const result = await mutate("comment.update", { commentId: commentItem.id, body: draft.trim() }, { successMessage: "评论已更新" });
    setSaving(false);
    if (result) setEditing(false);
  }

  async function removeComment() {
    if (!window.confirm("删除这条评论？")) return;
    await mutate("comment.delete", { commentId: commentItem.id }, { successMessage: "评论已删除" });
  }

  return (
    <div className={cn(commentItem.resolvedAt && "opacity-70")}>
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className="font-medium text-primary">{author?.name ?? "未知用户"}</span>
        <span className="text-tertiary">评论</span>
        {parent ? <span className="truncate text-[10px] text-tertiary">回复 {parentAuthor?.name ?? "评论"}</span> : null}
        {commentItem.resolvedAt ? <span className="rounded bg-[var(--success-soft)] px-1.5 py-0.5 text-[9px] font-medium text-success">已解决</span> : null}
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" onClick={onReply} className="grid size-6 place-items-center rounded text-tertiary hover:bg-surface-hover hover:text-primary" aria-label="回复评论"><Reply size={12} /></button>
          <button type="button" onClick={() => void mutate(commentItem.resolvedAt ? "comment.reopen" : "comment.resolve", { commentId: commentItem.id }, { successMessage: commentItem.resolvedAt ? "评论已重新打开" : "评论已解决" })} className="grid size-6 place-items-center rounded text-tertiary hover:bg-surface-hover hover:text-primary" aria-label={commentItem.resolvedAt ? "重新打开评论" : "解决评论"}>
            {commentItem.resolvedAt ? <RotateCcw size={12} /> : <CheckCircle2 size={12} />}
          </button>
          {canManage ? (
            <>
              <button type="button" onClick={() => { setDraft(commentItem.body); setEditing(true); }} className="grid size-6 place-items-center rounded text-tertiary hover:bg-surface-hover hover:text-primary" aria-label="编辑评论"><Pencil size={12} /></button>
              <button type="button" onClick={() => void removeComment()} className="grid size-6 place-items-center rounded text-tertiary hover:bg-[var(--danger-soft)] hover:text-danger" aria-label="删除评论"><Trash2 size={12} /></button>
            </>
          ) : null}
        </div>
      </div>
      {editing ? (
        <div>
          <textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-24 w-full resize-y rounded-md border border-border bg-surface p-2.5 text-sm text-primary outline-none focus:border-accent" />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="h-7 rounded-md px-2.5 text-[11px] text-secondary hover:bg-surface-hover">取消</button>
            <button type="button" onClick={() => void saveComment()} disabled={saving || !draft.trim()} className="h-7 rounded-md bg-accent px-2.5 text-[11px] font-medium text-white disabled:opacity-50">保存</button>
          </div>
        </div>
      ) : (
        <div className="prose prose-sm max-w-none text-secondary dark:prose-invert"><ReactMarkdown>{commentItem.body}</ReactMarkdown></div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <SmilePlus size={11} className="mr-0.5 text-tertiary" aria-hidden="true" />
        {reactionChoices.map((emoji) => {
          const matching = reactions.filter((reaction) => reaction.emoji === emoji);
          const active = matching.some((reaction) => reaction.userId === data.currentUser.id);
          return (
            <button key={emoji} type="button" aria-pressed={active} onClick={() => void mutate("comment.reaction.toggle", { commentId: commentItem.id, emoji }, { refresh: true })} className={cn("inline-flex h-6 items-center gap-1 rounded-md border border-border px-1.5 text-[11px] hover:bg-surface-hover", active && "border-accent bg-accent-soft")}>
              <span aria-hidden="true">{emoji}</span>{matching.length ? <span className="font-mono text-[9px] text-tertiary">{matching.length}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimelineEvent({ avatar, date, card = false, children }: { avatar: Parameters<typeof UserAvatar>[0]["user"]; date: string; card?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative flex gap-3 text-xs text-secondary before:absolute before:bottom-[-22px] before:left-[10px] before:top-6 before:w-px before:bg-border last:before:hidden">
      <UserAvatar user={avatar} size={21} className="relative z-[1]" />
      <div className={cn("min-w-0 flex-1 pt-0.5", card && "rounded-md border border-border bg-surface-raised p-3 pt-3")}>
        {children}
        <time className="mt-1 block text-[10px] text-tertiary">{formatDistanceToNowStrict(new Date(date), { addSuffix: true, locale: zhCN })}</time>
      </div>
    </div>
  );
}

function PropertyRow({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="group mb-1 grid min-h-8 grid-cols-[82px_1fr] items-center rounded px-1.5 text-xs transition-colors hover:bg-surface-hover">
      <span className="flex items-center gap-2 text-tertiary">{icon}{label}</span>
      <div className="min-w-0 text-primary">{children}</div>
    </div>
  );
}

function MobileProperty({ label, children }: { label: string; children: React.ReactElement<{ className?: string }> }) {
  return (
    <label className="grid gap-1 text-[10px] font-medium uppercase tracking-[0.06em] text-tertiary">
      {label}
      <span className="[&>input]:h-9 [&>input]:w-full [&>input]:rounded-md [&>input]:border [&>input]:border-border [&>input]:bg-surface [&>input]:px-2 [&>input]:text-xs [&>input]:text-primary [&>select]:h-9 [&>select]:w-full [&>select]:rounded-md [&>select]:border [&>select]:border-border [&>select]:bg-surface [&>select]:px-2 [&>select]:text-xs [&>select]:text-primary">
        {children}
      </span>
    </label>
  );
}

function ActionButton({ icon, label, danger = false, onClick }: { icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cn("flex h-8 w-full items-center gap-2 rounded px-2 text-xs text-secondary transition-colors hover:bg-surface-hover hover:text-primary", danger && "hover:bg-[var(--danger-soft)] hover:text-danger")}>{icon}{label}</button>;
}

function activityLabel(action: string): string {
  const labels: Record<string, string> = {
    created: "创建了 Issue",
    updated: "更新了 Issue",
    "status.changed": "更改了状态",
    "assignee.changed": "更改了负责人",
    "priority.changed": "更改了优先级",
    commented: "添加了评论",
    subscribed: "订阅了 Issue",
  };
  return labels[action] ?? action.replaceAll(".", " ");
}

function relationLabel(type: IssueRelationType, outgoing: boolean): string {
  if (type === "related") return "相关";
  if (type === "duplicate") return outgoing ? "重复于" : "重复项";
  return outgoing ? "阻塞" : "被阻塞";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
