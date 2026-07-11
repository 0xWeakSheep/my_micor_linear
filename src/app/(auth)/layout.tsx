import { Orbit } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh overflow-auto bg-background">
      <div className="surface-grid pointer-events-none absolute inset-0 opacity-[0.28]" />
      <div className="pointer-events-none absolute left-1/2 top-[-220px] h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--accent-soft)_0%,transparent_68%)] opacity-70 blur-2xl" />

      <section className="relative z-10 m-auto w-full max-w-[420px] px-6 py-12 sm:px-8">
        <div className="mb-10 flex items-center justify-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-white shadow-[0_8px_20px_color-mix(in_srgb,var(--accent)_30%,transparent)]">
            <Orbit size={18} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.02em]">Orbit</span>
        </div>
        <div className="rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] p-6 shadow-[var(--shadow-popover)] backdrop-blur-xl sm:p-8">
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-tertiary">
          为小团队打造的产品协作空间 · 不包含 AI 功能
        </p>
      </section>
    </main>
  );
}
