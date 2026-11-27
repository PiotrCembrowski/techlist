import { ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Quiet verification badge: always an icon plus words, never colour alone. Only published
 * products are public; whether an editor has verified one is recorded by `last_verified_at`
 * (DECISIONS D77). Individual unverified values keep their own marker in the spec table.
 */
export function VerificationBadge({
  verifiedAt,
  framed = false,
  linkToPolicy = false,
  className,
}: {
  verifiedAt: Date | null | undefined;
  framed?: boolean;
  linkToPolicy?: boolean;
  className?: string;
}) {
  const date = formatDate(verifiedAt ?? null);
  const Icon = date ? ShieldCheck : ShieldAlert;
  const content = (
    <>
      <Icon aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0" />
      <span>{date ? `Verified · ${date}` : "Not verified yet"}</span>
    </>
  );
  const classes = cn(
    "inline-flex items-center gap-1.5 text-xs",
    framed && "border px-2.5 py-1",
    !date && framed && "border-warning/40",
    date ? "text-verified" : "text-warning",
    className,
  );
  return linkToPolicy ? (
    <Link
      href="/data-policy#verification"
      className={cn(classes, "underline-offset-2 hover:underline")}
    >
      {content}
    </Link>
  ) : (
    <span className={classes}>{content}</span>
  );
}
