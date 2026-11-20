"use client";

import { ChevronDown, Globe } from "lucide-react";
import { useRef, useTransition } from "react";
import { setMarketAction } from "@/app/actions/market";
import { cn } from "@/lib/utils";

export interface MarketOption {
  code: string;
  label: string;
}

/**
 * Header market selector. Offers outside the selected market are grouped under "Other markets"
 * on product pages; prices are never converted.
 */
export function MarketSelector({
  value,
  options,
  className,
  id = "market-select",
}: {
  value: string;
  options: MarketOption[];
  className?: string;
  id?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      ref={formRef}
      action={setMarketAction}
      className={cn("relative", className)}
      aria-busy={pending}
    >
      <label htmlFor={id} className="sr-only">
        Market
      </label>
      <Globe
        aria-hidden="true"
        strokeWidth={1.5}
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
      />
      <select
        id={id}
        name="market"
        defaultValue={value}
        onChange={() => startTransition(() => formRef.current?.requestSubmit())}
        className="h-11 w-full cursor-pointer appearance-none border bg-background pr-8 pl-8 text-sm font-medium hover:bg-accent sm:h-9"
      >
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        strokeWidth={1.5}
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2"
      />
      <noscript>
        <button type="submit" className="mt-1 border px-2 py-1 text-xs">
          Apply market
        </button>
      </noscript>
    </form>
  );
}
