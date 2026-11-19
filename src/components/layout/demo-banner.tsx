import { Info } from "lucide-react";

/** Site-wide notice shown whenever ENABLE_DEMO_DATA=true (rule 2.1.2). */
export function DemoBanner() {
  return (
    <div
      role="note"
      aria-label="Demonstration data"
      className="flex min-h-[30px] items-center justify-center gap-2 border-b bg-muted px-4 py-1.5 text-center text-xs"
    >
      <Info aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0" />
      <span>Demonstration data — products, brands and offers on this site are fictional.</span>
    </div>
  );
}
