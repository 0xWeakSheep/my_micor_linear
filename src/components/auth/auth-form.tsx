"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuthFormProps {
  mode: "login" | "signup";
  allowSignupLink?: boolean;
}

interface AuthResponse {
  ok?: boolean;
  error?: string;
  redirect?: string;
}

export function AuthForm({ mode, allowSignupLink = true }: AuthFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mode === "login"
            ? { email, password }
            : { name, email, password, workspaceName },
        ),
      });
      const result = (await response.json()) as AuthResponse;

      if (!response.ok || !result.ok) {
        setError(result.error ?? "请求失败，请稍后再试。");
        return;
      }

      const requestedPath = new URLSearchParams(window.location.search).get("next");
      const safeRequestedPath = requestedPath?.startsWith("/") && !requestedPath.startsWith("//")
        ? requestedPath
        : null;
      router.push(safeRequestedPath ?? result.redirect ?? "/");
      router.refresh();
    } catch {
      setError("无法连接到服务，请检查网络后重试。");
    } finally {
      setLoading(false);
    }
  }

  const isLogin = mode === "login";

  return (
    <form method="post" className="mt-8 space-y-4" onSubmit={handleSubmit}>
      {!isLogin ? (
        <>
          <Field label="姓名">
            <input
              id="name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-11 w-full rounded-md border border-border bg-surface px-3.5 text-sm text-primary transition-colors placeholder:text-tertiary hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_22%,transparent)]"
              placeholder="你的姓名"
              minLength={2}
              required
            />
          </Field>
          <Field label="工作区名称">
            <input
              id="workspaceName"
              name="workspaceName"
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              className="h-11 w-full rounded-md border border-border bg-surface px-3.5 text-sm text-primary transition-colors placeholder:text-tertiary hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_22%,transparent)]"
              placeholder="例如：Acme"
              minLength={2}
              required
            />
          </Field>
        </>
      ) : null}

      <Field label="邮箱">
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-11 w-full rounded-md border border-border bg-surface px-3.5 text-sm text-primary transition-colors placeholder:text-tertiary hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_22%,transparent)]"
          placeholder="name@company.com"
          required
        />
      </Field>

      <Field label="密码">
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={isLogin ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-11 w-full rounded-md border border-border bg-surface px-3.5 pr-11 text-sm text-primary transition-colors placeholder:text-tertiary hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_22%,transparent)]"
            placeholder="至少 8 个字符"
            minLength={8}
            required
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-tertiary transition-colors hover:text-primary"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "隐藏密码" : "显示密码"}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </Field>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-[color-mix(in_srgb,var(--danger)_35%,var(--border))] bg-[var(--danger-soft)] px-3 py-2.5 text-sm text-[var(--danger)]"
        >
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className={cn(
          "flex h-11 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60",
        )}
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : null}
        {isLogin ? "登录" : "创建工作区"}
        {!loading ? <ArrowRight size={15} /> : null}
      </button>

      {isLogin && !allowSignupLink ? (
        <p className="pt-1 text-center text-sm text-secondary">需要加入工作区？请向管理员获取邀请链接。</p>
      ) : (
        <p className="pt-1 text-center text-sm text-secondary">
          {isLogin ? "还没有工作区？" : "已经有账户？"}{" "}
          <Link
            href={isLogin ? "/signup" : "/login"}
            className="font-medium text-primary underline decoration-border-strong underline-offset-4 hover:decoration-primary"
          >
            {isLogin ? "创建一个" : "返回登录"}
          </Link>
        </p>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = label === "邮箱" ? "email" : label === "密码" ? "password" : label === "姓名" ? "name" : "workspaceName";

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}
