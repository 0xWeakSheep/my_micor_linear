import type {
  ComponentProps,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

export function SettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-7 sm:py-9">
      <header className="mb-7">
        <h1 className="text-xl font-semibold tracking-[-0.03em]">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-5 text-secondary">{description}</p>
      </header>
      <div className="space-y-7">{children}</div>
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-[-0.01em]">{title}</h2>
          {description ? <p className="mt-1 text-xs leading-4 text-tertiary">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">{children}</div>
    </section>
  );
}

export function FormBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("space-y-4 p-4 sm:p-5", className)} {...props} />;
}

export function FormFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-subtle px-4 py-3 sm:px-5",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block text-[11px] font-medium text-secondary">
      {label}
      {required ? <span className="ml-0.5 text-danger">*</span> : null}
      {hint ? <span className="ml-1 font-normal text-tertiary">{hint}</span> : null}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

export function NativeInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-primary outline-none transition-colors placeholder:text-tertiary hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function NativeTextarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full resize-y rounded-md border border-border bg-surface px-2.5 py-2 text-sm leading-5 text-primary outline-none transition-colors placeholder:text-tertiary hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-8 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-primary outline-none transition-colors hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-5 px-4 py-3.5 sm:px-5">
      <span>
        <span className="block text-sm font-medium text-primary">{title}</span>
        <span className="mt-0.5 block text-xs leading-4 text-tertiary">{description}</span>
      </span>
      <input
        type="checkbox"
        className="size-4 shrink-0 accent-[var(--accent)]"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
    </label>
  );
}

export function EmptyRows({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="px-5 py-10 text-center">
      <span className="mx-auto grid size-9 place-items-center rounded-lg border border-border bg-surface-subtle text-tertiary">
        {icon}
      </span>
      <p className="mt-2 text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-4 text-tertiary">{description}</p>
    </div>
  );
}

export const dividerClassName = "divide-y divide-border";
