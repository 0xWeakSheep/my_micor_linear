"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Loader2, Mail, Users } from "lucide-react";

import type { ActionResult } from "@/lib/domain";
import type { InvitationSummary } from "@/modules/invitations/service";

interface InviteFormProps {
  invitation: InvitationSummary | null;
  signedInEmail: string | null;
  token: string;
}

interface AcceptedResult {
  redirect: string;
}

export function InviteForm({ invitation, signedInEmail, token }: InviteFormProps) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!invitation) {
    return <InviteState title="邀请链接无效" description="这个链接不存在或已被替换，请联系工作区管理员重新邀请。" />;
  }
  if (invitation.acceptedAt) {
    return <InviteState icon={<CheckCircle2 size={20} />} title="邀请已使用" description="这个邀请已经被接受。你可以直接登录 Micro Linear。" action={<LinkButton href="/login">前往登录</LinkButton>} />;
  }
  if (invitation.expired) {
    return <InviteState title="邀请已过期" description="请联系工作区管理员生成一个新的邀请链接。" />;
  }

  const activeInvitation = invitation;
  const invitedEmail = activeInvitation.email.toLocaleLowerCase();
  const currentEmail = signedInEmail?.toLocaleLowerCase() ?? null;
  const sessionMatches = currentEmail === invitedEmail;
  const returnPath = `/invite/${encodeURIComponent(token)}`;
  const loginHref = `/login?next=${encodeURIComponent(returnPath)}`;

  async function accept(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          ...(!signedInEmail && !activeInvitation.existingUser ? { name, password } : {}),
        }),
      });
      const result = await response.json() as ActionResult<AcceptedResult>;
      if (!response.ok || !result.ok || !result.data) throw new Error(result.error ?? "无法接受邀请");
      window.location.href = result.data.redirect;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法接受邀请");
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-xl border border-border bg-accent-soft text-accent">
          <Users size={19} />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-[-0.025em] text-primary">加入 {activeInvitation.workspace.name}</h1>
        <p className="mt-1.5 text-sm text-secondary">你被邀请以{roleLabel(activeInvitation.role)}身份加入这个工作区。</p>
      </div>

      <div className="mt-6 flex items-center gap-3 rounded-lg border border-border bg-surface-subtle px-3.5 py-3">
        <Mail size={15} className="shrink-0 text-tertiary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-primary">{activeInvitation.email}</p>
          <p className="text-xs text-tertiary">邀请邮箱</p>
        </div>
      </div>

      {signedInEmail && !sessionMatches ? (
        <div className="mt-5 rounded-lg border border-[color-mix(in_srgb,var(--warning)_35%,var(--border))] bg-[var(--warning-soft)] p-3 text-sm text-secondary">
          当前登录的是 <strong className="text-primary">{signedInEmail}</strong>。请使用受邀邮箱登录后再接受。
          <LinkButton className="mt-3 w-full" href={loginHref}>切换账户</LinkButton>
        </div>
      ) : activeInvitation.existingUser && !signedInEmail ? (
        <div className="mt-5">
          <p className="text-center text-sm text-secondary">此邮箱已有 Micro Linear 账户，请先登录以确认身份。</p>
          <LinkButton className="mt-4 w-full" href={loginHref}>登录并继续</LinkButton>
        </div>
      ) : (
        <form onSubmit={accept} className="mt-5 space-y-4">
          {!signedInEmail ? (
            <>
              <label className="block space-y-1.5 text-sm font-medium text-secondary">
                姓名
                <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3.5 text-sm text-primary outline-none focus:border-accent focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_22%,transparent)]" />
              </label>
              <label className="block space-y-1.5 text-sm font-medium text-secondary">
                设置密码
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} required className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3.5 text-sm text-primary outline-none focus:border-accent focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_22%,transparent)]" />
              </label>
            </>
          ) : null}
          {error ? <div role="alert" className="rounded-md border border-[color-mix(in_srgb,var(--danger)_35%,var(--border))] bg-[var(--danger-soft)] px-3 py-2.5 text-sm text-danger">{error}</div> : null}
          <button type="submit" disabled={loading || (!signedInEmail && (name.trim().length < 2 || password.length < 8))} className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={15} />}
            接受邀请
          </button>
        </form>
      )}
    </div>
  );
}

function InviteState({ title, description, icon, action }: { title: string; description: string; icon?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="text-center"><span className="mx-auto grid size-11 place-items-center rounded-xl border border-border bg-surface-subtle text-tertiary">{icon ?? <Mail size={19} />}</span><h1 className="mt-4 text-xl font-semibold tracking-[-0.025em]">{title}</h1><p className="mt-2 text-sm leading-6 text-secondary">{description}</p>{action ? <div className="mt-5">{action}</div> : null}</div>;
}

function LinkButton({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return <Link href={href} className={`inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover ${className}`}>{children}</Link>;
}

function roleLabel(role: InvitationSummary["role"]): string {
  return role === "admin" ? "管理员" : role === "guest" ? "访客" : "成员";
}
