import { Check, ChevronRight, CircleHelp, Clock, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { DemoTag } from "@/components/product/demo-tag";
import { siteConfig } from "@/config/site";
import { formatPrice, formatRelative, marketName } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  daysSince,
  type GroupedOffers,
  type MarketOffers,
  type OfferWithState,
} from "@/modules/offers/display";

const CONDITION: Record<OfferWithState["condition"], string> = {
  new: "New",
  used: "Used",
  refurbished: "Refurbished",
};

const AVAILABILITY = {
  in_stock: { label: "In stock", Icon: Check, className: "text-success" },
  preorder: { label: "Pre-order", Icon: Clock, className: "text-foreground" },
  unknown: { label: "Availability unknown", Icon: CircleHelp, className: "text-muted-foreground" },
  out_of_stock: { label: "Out of stock", Icon: X, className: "text-destructive" },
} as const;

const GRID =
  "lg:grid lg:grid-cols-[minmax(0,2.2fr)_0.8fr_1fr_1.2fr_1.1fr_1.3fr_170px] lg:items-center lg:gap-3";

function Disclosure() {
  return (
    <p className="text-xs text-muted-foreground">
      We may earn a commission when you buy through these links. It never changes which offers we
      list or their order.{" "}
      <Link href="/affiliate-disclosure" className="text-primary">
        How {siteConfig.name} is funded
      </Link>
    </p>
  );
}

function OfferRow({ o, showVariant, now }: { o: OfferWithState; showVariant: boolean; now: Date }) {
  const a = AVAILABILITY[o.availabilityStatus];
  const stale = o.freshness === "stale";
  const checked = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(o.lastCheckedAt);
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-3 text-sm",
        GRID,
        stale && "border-dashed border-warning/40 text-foreground/80",
      )}
    >
      <span className="flex basis-full flex-wrap items-center gap-2 font-medium lg:basis-auto">
        {o.retailerName}
        {o.isDemo ? <DemoTag /> : null}
        {showVariant && o.variantName ? (
          <span className="text-xs font-normal text-muted-foreground">{o.variantName}</span>
        ) : null}
      </span>
      <span className="model-number text-[13px]">
        <span className="sr-only">Market: </span>
        <abbr title={marketName(o.marketCountryCode)} className="no-underline">
          {o.marketCountryCode}
        </abbr>{" "}
        · {o.currency}
      </span>
      <span>
        <span className="sr-only">Condition: </span>
        {CONDITION[o.condition]}
      </span>
      <span className={cn("flex items-center gap-1.5", a.className)}>
        <a.Icon aria-hidden="true" strokeWidth={1.8} className="size-3.5 shrink-0" />
        {a.label}
      </span>
      <span className={cn("text-muted-foreground", stale && "text-warning")}>
        <span className="sr-only">Last checked: </span>
        <time dateTime={o.lastCheckedAt.toISOString()} title={`${checked} UTC`}>
          {stale
            ? `Checked ${formatRelative(o.lastCheckedAt, now)}`
            : formatRelative(o.lastCheckedAt, now)}
        </time>
      </span>
      <span className="mt-1 flex min-w-[50%] flex-1 flex-col lg:mt-0 lg:min-w-0 lg:items-end">
        <span
          className={cn(
            "font-heading text-xl font-semibold",
            o.availabilityStatus === "out_of_stock" && "text-muted-foreground",
          )}
        >
          <span className="sr-only">Price: </span>
          {formatPrice(o.priceAmount, o.currency)}
        </span>
        {o.originalPriceAmount && Number(o.originalPriceAmount) > Number(o.priceAmount) ? (
          <span className="text-xs text-muted-foreground">
            was <s>{formatPrice(o.originalPriceAmount, o.currency)}</s>
          </span>
        ) : null}
        {o.shippingCost !== null ? (
          <span className="text-xs text-muted-foreground">
            {Number(o.shippingCost) === 0
              ? "Free shipping"
              : `+ ${formatPrice(o.shippingCost, o.currency)} shipping`}
          </span>
        ) : null}
      </span>
      <span className="mt-1 flex lg:mt-0 lg:justify-end">
        {/* Plain <a>: route handler, no prefetch. Sponsored + nofollow per SPEC §7.6. */}
        <a
          href={`/go/${o.id}`}
          rel="sponsored nofollow noopener"
          target="_blank"
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 border px-3 font-heading font-semibold sm:min-h-9",
            stale ? "border-transparent text-primary hover:bg-primary/10" : "hover:bg-accent",
          )}
        >
          {stale ? "Check price" : "Go to retailer"}
          <ExternalLink aria-hidden="true" strokeWidth={1.5} className="size-3.5" />
          <span className="sr-only">
            {" "}
            at {o.retailerName} (opens in a new tab{o.isDemo ? "; demonstration retailer" : ""})
          </span>
        </a>
      </span>
    </li>
  );
}

function MarketBlock({
  g,
  showVariant,
  staleHours,
  now,
  heading,
}: {
  g: MarketOffers;
  showVariant: boolean;
  staleHours: number;
  now: Date;
  heading?: boolean;
}) {
  const oldest = g.stale.length
    ? Math.max(...g.stale.map((o) => daysSince(o.lastCheckedAt, now)))
    : 0;
  return (
    <div className="flex flex-col">
      {heading ? (
        <h4 className="mt-4 mb-1 font-heading text-base font-semibold tracking-[0.06em] uppercase">
          {marketName(g.market)} · {g.market}
        </h4>
      ) : null}
      {g.fresh.length ? (
        <ul aria-label={`Current offers in ${marketName(g.market)}`} className="border-t">
          {g.fresh.map((o) => (
            <OfferRow key={o.id} o={o} showVariant={showVariant} now={now} />
          ))}
        </ul>
      ) : null}
      {g.stale.length ? (
        <>
          <p className="flex items-center gap-2 pt-3 pb-1 text-[13px] font-medium text-warning">
            <Clock aria-hidden="true" strokeWidth={1.5} className="size-4" />
            Not checked in the last{" "}
            {staleHours % 24 === 0 ? `${staleHours / 24} days` : `${staleHours} hours`} — price last
            checked {oldest === 1 ? "1 day" : `${oldest} days`} ago, may have changed
          </p>
          <ul aria-label={`Older offers in ${marketName(g.market)}, prices may have changed`}>
            {g.stale.map((o) => (
              <OfferRow key={o.id} o={o} showVariant={showVariant} now={now} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/**
 * Offers section (SPEC §7.6 items 9–10): selected market first, stale offers below fresh ones
 * with a warning, other markets collapsed, honest empty state, affiliate disclosure.
 */
export function OfferList({
  offers,
  market,
  staleHours,
  showVariant,
  now = new Date(),
}: {
  offers: GroupedOffers;
  market: string;
  staleHours: number;
  showVariant: boolean;
  now?: Date;
}) {
  const title = market === "ALL" ? "Offers" : `Offers in ${marketName(market)}`;
  const otherCount = offers.otherMarkets.reduce((n, g) => n + g.fresh.length + g.stale.length, 0);
  return (
    <section id="offers" aria-labelledby="offers-title" className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex flex-col justify-between gap-2 border-b border-border-strong pb-2.5 md:flex-row md:items-baseline">
        <h2 id="offers-title" className="text-[28px]">
          {title}
        </h2>
        <div className="md:max-w-[520px] md:text-right">
          <Disclosure />
        </div>
      </div>

      {offers.total === 0 ? (
        <p className="py-4 text-muted-foreground">
          We don&rsquo;t have current retailer offers for this product yet.
        </p>
      ) : null}

      {offers.total > 0 && offers.primary.length === 0 && market !== "ALL" ? (
        <p className="py-2 text-muted-foreground">
          No current offers in {marketName(market)}. Offers from other markets are listed below.
        </p>
      ) : null}

      {offers.primary.length ? (
        <div>
          <div aria-hidden="true" className={cn("label-caps hidden pb-1", GRID)}>
            <span>Retailer</span>
            <span>Market</span>
            <span>Condition</span>
            <span>Availability</span>
            <span>Last checked</span>
            <span className="text-right">Price</span>
            <span />
          </div>
          {offers.primary.map((g) => (
            <MarketBlock
              key={g.market}
              g={g}
              showVariant={showVariant}
              staleHours={staleHours}
              now={now}
              heading={market === "ALL"}
            />
          ))}
        </div>
      ) : null}

      {offers.otherMarkets.length ? (
        <details className="group border-b">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-3 text-sm font-medium">
            <ChevronRight
              aria-hidden="true"
              strokeWidth={1.5}
              className="size-4 transition-transform group-open:rotate-90"
            />
            Other markets
            <span className="font-normal text-muted-foreground">
              {otherCount} {otherCount === 1 ? "offer" : "offers"} ·{" "}
              {offers.otherMarkets.map((g) => g.market).join(" · ")} — shown in original currency
            </span>
          </summary>
          <div className="pb-3">
            {offers.otherMarkets.map((g) => (
              <MarketBlock
                key={g.market}
                g={g}
                showVariant={showVariant}
                staleHours={staleHours}
                now={now}
                heading
              />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
