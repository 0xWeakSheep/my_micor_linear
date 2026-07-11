import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <main className="grid h-dvh place-items-center bg-background px-6">
      <div className="max-w-md text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-surface-subtle text-secondary">
          <SearchX size={20} aria-hidden="true" />
        </span>
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-tertiary">404</p>
        <h1 className="mt-1 text-lg font-semibold tracking-[-0.02em]">找不到这个页面</h1>
        <p className="mt-2 text-sm leading-6 text-secondary">
          它可能已被移动、删除，或者你没有访问权限。
        </p>
        <Link
          href="/"
          className="mx-auto mt-5 inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-surface-hover"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          返回工作区
        </Link>
      </div>
    </main>
  );
}
