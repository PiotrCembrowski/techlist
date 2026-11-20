"use client";

import { createContext, useActionState, useContext, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/admin/action";

const FieldErrors = createContext<Record<string, string>>({});
const Pending = createContext(false);

export function useFieldError(name: string): string | undefined {
  return useContext(FieldErrors)[name];
}

/**
 * Form bound to an admin Server Action. Submits via onSubmit (so React does not reset the
 * fields when validation fails) and announces the result. `confirm` asks before destructive actions.
 */
export function ActionForm({
  action,
  children,
  className,
  confirm,
  "aria-label": ariaLabel,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  confirm?: string;
  "aria-label"?: string;
}) {
  const [state, dispatch] = useActionState(action, undefined);
  const [pending, start] = useTransition();
  return (
    <form
      action={dispatch}
      aria-label={ariaLabel}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        start(() => dispatch(fd));
      }}
      className={cn("flex flex-col gap-4", className)}
    >
      <Pending.Provider value={pending}>
        <FieldErrors.Provider value={state?.fields ?? {}}>{children}</FieldErrors.Provider>
      </Pending.Provider>
      <div aria-live="polite" className="empty:hidden">
        {state?.error ? (
          <p
            key={state.at}
            role="alert"
            className="border border-destructive/40 px-3 py-2 text-sm text-destructive"
          >
            {state.error}
          </p>
        ) : state?.ok ? (
          <p
            key={state.at}
            role="status"
            className="border border-success/40 px-3 py-2 text-sm text-success"
          >
            {state.ok}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  name,
  value,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  name?: string;
  value?: string;
}) {
  const pending = useContext(Pending);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={cn(
        "inline-flex h-10 w-fit items-center justify-center border px-4 font-heading text-sm font-semibold disabled:opacity-45",
        variant === "primary" &&
          "border-primary bg-primary text-primary-foreground hover:bg-primary-hover",
        variant === "secondary" && "hover:bg-accent",
        variant === "danger" && "border-destructive text-destructive hover:bg-destructive/10",
      )}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

/** Error text for a field, linked via aria-describedby by the field components. */
export function FieldError({ name, id }: { name: string; id: string }) {
  const error = useFieldError(name);
  return error ? (
    <p id={id} className="text-xs text-destructive">
      {error}
    </p>
  ) : null;
}
