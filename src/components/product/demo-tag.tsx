import { cn } from "@/lib/utils";

/** Small "Demo" tag on demo product cards and offers (rule 2.1.2). */
export function DemoTag({ className }: { className?: string }) {
  return (
    <span
      title="Demonstration data: this record is fictional"
      className={cn(
        "inline-flex items-center border bg-muted px-2 py-px text-[11px] font-normal text-foreground",
        className,
      )}
    >
      Demo
    </span>
  );
}
