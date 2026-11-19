import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

/** Registration-mark glyph + set type. The name is live text, so the brand can be swapped in config. */
export function Wordmark({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  const box = size === "lg" ? "size-[30px]" : "size-5";
  const inset = size === "lg" ? "5px" : "3px";
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden="true"
        className={cn("relative block border-[1.5px] border-foreground", box)}
      >
        <span
          className="absolute left-1/2 -ml-[0.75px] w-[1.5px] bg-primary"
          style={{ top: inset, bottom: inset }}
        />
        <span
          className="absolute top-1/2 -mt-[0.75px] h-[1.5px] bg-primary"
          style={{ left: inset, right: inset }}
        />
      </span>
      <span
        className={cn(
          "font-heading leading-none font-semibold tracking-[0.04em] uppercase",
          size === "lg" ? "text-[38px]" : "text-[22px]",
        )}
      >
        {siteConfig.name}
      </span>
    </span>
  );
}
