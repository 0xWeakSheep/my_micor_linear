import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  startIcon?: ReactNode;
  endAdornment?: ReactNode;
  invalid?: boolean;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    className,
    containerClassName,
    startIcon,
    endAdornment,
    invalid = false,
    disabled,
    ...props
  },
  ref,
) {
  return (
    <span
      className={cn(
        "relative flex h-8 w-full items-center rounded-md border border-border bg-surface transition-colors duration-150 focus-within:border-accent focus-within:ring-2 focus-within:ring-[color-mix(in_srgb,var(--accent)_18%,transparent)] hover:border-border-strong",
        invalid &&
          "border-[var(--danger)] focus-within:border-[var(--danger)] focus-within:ring-[color-mix(in_srgb,var(--danger)_18%,transparent)]",
        disabled && "pointer-events-none opacity-50",
        containerClassName,
      )}
    >
      {startIcon ? (
        <span className="ml-2 inline-flex shrink-0 text-tertiary" aria-hidden="true">
          {startIcon}
        </span>
      ) : null}
      <input
        ref={ref}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-sm text-primary outline-none placeholder:text-[var(--text-placeholder)]",
          startIcon && "pl-2",
          endAdornment && "pr-2",
          className,
        )}
        {...props}
      />
      {endAdornment ? (
        <span className="mr-2 inline-flex shrink-0 items-center text-tertiary">
          {endAdornment}
        </span>
      ) : null}
    </span>
  );
});
