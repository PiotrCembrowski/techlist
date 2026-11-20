import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-10", className)}>
      {children}
    </div>
  );
}

/** Section with a hairline-ruled heading row, as on the 1a board. */
export function Section({
  title,
  id,
  action,
  children,
  className,
}: {
  title: string;
  id: string;
  action?: { href: string; label: string };
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("py-12", className)}>
      <Container className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between gap-4 border-b border-border-strong pb-2.5">
          <h2 id={id} className="text-[28px]">
            {title}
          </h2>
          {action ? (
            <Link
              href={action.href}
              className="shrink-0 text-sm text-primary hover:text-primary-active"
            >
              {action.label}
            </Link>
          ) : null}
        </div>
        {children}
      </Container>
    </section>
  );
}
