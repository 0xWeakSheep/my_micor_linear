export default function Loading() {
  return (
    <div className="flex h-dvh w-full bg-background" aria-label="正在加载工作区">
      <aside className="hidden w-[248px] shrink-0 border-r border-border bg-sidebar p-3 md:block">
        <Skeleton className="mb-4 h-8 w-full" />
        <Skeleton className="mb-1.5 h-8 w-[76%]" />
        <Skeleton className="mb-1.5 h-8 w-[62%]" />
        <Skeleton className="mb-6 h-8 w-[70%]" />
        <Skeleton className="mb-2 h-3 w-20" />
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton key={index} className="mb-1.5 h-8 w-full" />
        ))}
      </aside>
      <main className="min-w-0 flex-1">
        <div className="flex h-12 items-center gap-3 border-b border-border px-4">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="ml-auto h-7 w-24" />
        </div>
        <div className="p-6">
          <Skeleton className="mb-3 h-7 w-44" />
          <Skeleton className="mb-8 h-4 w-72" />
          <div className="overflow-hidden rounded-lg border border-border">
            {Array.from({ length: 10 }, (_, index) => (
              <div key={index} className="flex h-11 items-center gap-3 border-b border-border px-3 last:border-0">
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 flex-1 max-w-[520px]" />
                <Skeleton className="ml-auto size-5 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function Skeleton({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-[color-mix(in_srgb,var(--surface-active)_75%,transparent)] ${className}`}
    />
  );
}
