import { ShieldAlert, ShieldCheck, ShieldHalf } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATES = {
  verified: { label: "Verified", Icon: ShieldCheck, className: "text-verified" },
  partially_verified: {
    label: "Partially verified",
    Icon: ShieldHalf,
    className: "text-foreground",
  },
  needs_review: { label: "Needs review", Icon: ShieldAlert, className: "text-warning" },
} as const;

/**
 * Quiet verification badge: always an icon plus words, never colour alone. Draft and rejected
 * products are never public, so they have no badge.
 */
export function VerificationBadge({
  status,
  verifiedAt,
  framed = false,
  linkToPolicy = false,
  className,
}: {
  status: string;
  verifiedAt?: Date | null;
  framed?: boolean;
  linkToPolicy?: boolean;
  className?: string;
}) {
  const state = STATES[status as keyof typeof STATES];
  if (!state) return null;
  const { Icon } = state;
  const date = status !== "needs_review" ? formatDate(verifiedAt ?? null) : null;
  const content = (
    <>
      <Icon aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0" />
      <span>
        {state.label}
        {date ? ` · ${date}` : ""}
      </span>
    </>
  );
  const classes = cn(
    "inline-flex items-center gap-1.5 text-xs",
    framed && "border px-2.5 py-1",
    status === "needs_review" && framed && "border-warning/40",
    state.className,
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
