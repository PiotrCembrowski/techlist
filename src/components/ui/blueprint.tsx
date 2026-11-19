import type { ComponentProps, ElementType } from "react";
import { cn } from "@/lib/utils";

type Corner = "tl" | "tr" | "bl" | "br";

/** Registration marks for any `.blueprint` element. */
export function Corners({ only }: { only?: Corner[] }) {
  return (
    <>
      {(only ?? (["tl", "tr", "bl", "br"] as const)).map((c) => (
        <i key={c} aria-hidden="true" className={`corner ${c}`} />
      ))}
    </>
  );
}

type BlueprintProps<T extends ElementType> = { as?: T; corners?: Corner[] } & Omit<
  ComponentProps<T>,
  "as"
>;

/** A hairline frame with "+" registration marks — the system's card, figure and section object. */
export function Blueprint<T extends ElementType = "div">({
  as,
  corners,
  className,
  children,
  ...rest
}: BlueprintProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag className={cn("blueprint", className)} {...rest}>
      <Corners only={corners} />
      {children}
    </Tag>
  );
}
