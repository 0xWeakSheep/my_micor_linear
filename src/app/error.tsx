"use client";

import { AlertCircle, RotateCcw } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid h-dvh place-items-center bg-background px-6">
      <div className="max-w-md text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-[var(--danger-soft)] text-danger">
          <AlertCircle size={20} aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-semibold tracking-[-0.02em]">工作区加载失败</h1>
        <p className="mt-2 text-sm leading-6 text-secondary">
          {error.message || "出现了一个意外错误。你的数据没有丢失，可以安全地重试。"}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mx-auto mt-5 flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-surface-hover"
        >
          <RotateCcw size={15} aria-hidden="true" />
          重新加载
        </button>
        {error.digest ? <p className="mt-4 font-mono text-[11px] text-tertiary">{error.digest}</p> : null}
      </div>
    </main>
  );
}
