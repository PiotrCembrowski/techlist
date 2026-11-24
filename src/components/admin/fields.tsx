import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FieldError } from "./form";

const control =
  "h-10 w-full min-w-0 border bg-background px-2.5 text-sm aria-[invalid=true]:border-destructive";

/** Label text only; the hint is separate and linked with aria-describedby (short accessible names). */
function Label({
  id,
  label,
  hint,
  required,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
        {/* The input itself carries `required`, which assistive technology announces. */}
        {required ? (
          <span aria-hidden="true" className="text-destructive">
            {" "}
            *
          </span>
        ) : null}
      </label>
      {hint ? (
        <span id={`${id}-hint`} className="text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint?: string) => (hint ? `${id}-hint ${id}-err` : `${id}-err`);

interface Common {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  /** Field-error key when it differs from the input name (service issue path). */
  errorKey?: string;
  /** Unique id prefix when several forms on one page share field names. */
  idPrefix?: string;
}

export function TextField({
  defaultValue,
  type = "text",
  placeholder,
  ...p
}: Common & { defaultValue?: string | number | null; type?: string; placeholder?: string }) {
  const id = `${p.idPrefix ?? "f"}-${p.name}`;
  return (
    <div className={cn("flex flex-col gap-1.5", p.className)}>
      <Label id={id} label={p.label} hint={p.hint} required={p.required} />
      <input
        id={id}
        name={p.name}
        type={type}
        required={p.required}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        aria-describedby={describedBy(id, p.hint)}
        className={control}
      />
      <FieldError name={p.errorKey ?? p.name} id={`${id}-err`} />
    </div>
  );
}

export function TextArea({
  defaultValue,
  rows = 4,
  ...p
}: Common & { defaultValue?: string | null; rows?: number }) {
  const id = `${p.idPrefix ?? "f"}-${p.name}`;
  return (
    <div className={cn("flex flex-col gap-1.5", p.className)}>
      <Label id={id} label={p.label} hint={p.hint} required={p.required} />
      <textarea
        id={id}
        name={p.name}
        rows={rows}
        required={p.required}
        defaultValue={defaultValue ?? ""}
        aria-describedby={describedBy(id, p.hint)}
        className="min-h-20 w-full border bg-background px-2.5 py-2 text-sm"
      />
      <FieldError name={p.errorKey ?? p.name} id={`${id}-err`} />
    </div>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function SelectField({
  options,
  defaultValue,
  emptyLabel,
  ...p
}: Common & { options: Option[]; defaultValue?: string | null; emptyLabel?: string }) {
  const id = `${p.idPrefix ?? "f"}-${p.name}`;
  return (
    <div className={cn("flex flex-col gap-1.5", p.className)}>
      <Label id={id} label={p.label} hint={p.hint} required={p.required} />
      <select
        id={id}
        name={p.name}
        required={p.required}
        defaultValue={defaultValue ?? ""}
        aria-describedby={describedBy(id, p.hint)}
        className={control}
      >
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldError name={p.errorKey ?? p.name} id={`${id}-err`} />
    </div>
  );
}

export function CheckboxField({
  name,
  label,
  defaultChecked,
  hint,
  idPrefix = "cb",
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  hint?: string;
  idPrefix?: string;
}) {
  const hintId = hint ? `${idPrefix}-${name}-hint` : undefined;
  return (
    <div className="flex min-h-10 flex-col">
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          aria-describedby={hintId}
          className="mt-0.5 size-4 accent-[var(--primary)]"
        />
        {label}
      </label>
      {hint ? (
        <span id={hintId} className="pl-6 text-xs text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function FieldGrid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  return (
    <div
      className={cn(
        "grid gap-4",
        cols === 2 && "sm:grid-cols-2",
        cols === 3 && "sm:grid-cols-3",
        cols === 4 && "sm:grid-cols-2 lg:grid-cols-4",
      )}
    >
      {children}
    </div>
  );
}

export function AdminSection({
  title,
  id,
  children,
  actions,
}: {
  title: string;
  id?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id ? `${id}-title` : undefined}
      id={id}
      className="flex flex-col gap-4 border p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={id ? `${id}-title` : undefined} className="text-2xl">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function AdminTable({
  head,
  children,
  empty,
  label,
}: {
  head: string[];
  children: ReactNode;
  empty?: string;
  /** Accessible name of the (horizontally scrollable) table region. */
  label?: string;
}) {
  return (
    // Focusable so keyboard users can scroll wide tables on small screens (WCAG 2.1.1).
    <div
      role="region"
      tabIndex={0}
      aria-label={label ?? `Table: ${head.filter(Boolean).join(", ")}`}
      className="overflow-x-auto border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="label-caps border-b px-3 py-2 text-left font-normal whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_tr:hover]:bg-accent">
          {children}
        </tbody>
      </table>
      {empty ? <p className="px-3 py-4 text-sm text-muted-foreground">{empty}</p> : null}
    </div>
  );
}

export function StatusPill({ value }: { value: string }) {
  return (
    <span className="inline-flex border px-1.5 text-xs whitespace-nowrap">
      {value.replace(/_/g, " ")}
    </span>
  );
}
