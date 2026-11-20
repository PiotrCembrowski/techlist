import Link from "next/link";
import { CompareToggle } from "@/components/compare/compare-toggle";
import { Blueprint } from "@/components/ui/blueprint";
import { formatPrice, marketName } from "@/lib/format";
import type { ProductCardData } from "@/modules/catalog/service";
import { DemoTag } from "./demo-tag";
import { ImagePlaceholder } from "./image-placeholder";
import { VerificationBadge } from "./verification-badge";

const STATUS_LABEL: Record<string, string> = {
  announced: "Announced",
  discontinued: "Discontinued",
};

function OfferLine({ card, market }: { card: ProductCardData; market: string }) {
  const o = card.offer;
  if (market === "ALL") {
    return o ? (
      <span className="text-xs text-muted-foreground">
        {o.offerCount} current {o.offerCount === 1 ? "offer" : "offers"} in {o.marketCount}{" "}
        {o.marketCount === 1 ? "market" : "markets"}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">No current offers</span>
    );
  }
  if (!o)
    return (
      <span className="text-xs text-muted-foreground">
        No current offers in {marketName(market)}
      </span>
    );
  if (!o.price || !o.currency) {
    return (
      <span className="text-xs text-muted-foreground">
        {o.offerCount} {o.offerCount === 1 ? "offer" : "offers"} in {market}, none in stock
      </span>
    );
  }
  return (
    <span className="flex flex-col">
      <span className="text-[11px] text-muted-foreground">
        From · {o.offerCount} {o.offerCount === 1 ? "offer" : "offers"} in {market}
      </span>
      <span className="font-heading text-[22px] leading-tight font-semibold">
        {formatPrice(o.price, o.currency)}
      </span>
    </span>
  );
}

/**
 * Product card (direction 1a): image, brand, name, one distinguishing line, up to four key specs,
 * lowest fresh offer for the selected market. No ratings or review counts (rule: SPEC §3 honesty).
 */
export function ProductCard({
  card,
  market,
  headingLevel = 3,
}: {
  card: ProductCardData;
  market: string;
  headingLevel?: 2 | 3;
}) {
  const H = `h${headingLevel}` as "h2" | "h3";
  const status = STATUS_LABEL[card.productStatus];
  return (
    <Blueprint as="article" className="group flex h-full flex-col bg-background">
      <ImagePlaceholder
        icon={card.category.icon}
        className="aspect-[4/3] border-b"
        iconClassName="size-10"
      >
        {card.isDemo ? <DemoTag className="absolute top-2.5 left-2.5" /> : null}
        {status ? (
          <span className="absolute top-2.5 right-2.5 border bg-background px-2 py-px text-[11px] text-foreground">
            {status}
          </span>
        ) : null}
      </ImagePlaceholder>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <span className="text-[11px] font-medium tracking-[0.1em] text-primary uppercase">
          {card.brand.name} · {card.category.name}
        </span>
        <H className="text-2xl leading-[1.05]">
          {/* The stretched link makes the whole card clickable while keeping one focusable link. */}
          <Link href={card.href} className="after:absolute after:inset-0 hover:text-primary">
            {card.name}
          </Link>
        </H>
        <span className="model-number text-[13px] text-muted-foreground">
          {[card.modelNumber, card.releaseYear].filter(Boolean).join(" · ")}
        </span>
        {card.keySpecs.length ? (
          <dl className="mt-1 grid grid-cols-2 border-t border-l text-xs">
            {card.keySpecs.map((s) => (
              <div key={s.key} className="border-r border-b px-2 py-1.5">
                <dt className="text-muted-foreground">{s.label}</dt>
                <dd className="font-medium break-words">{s.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <VerificationBadge
          status={card.verificationStatus}
          verifiedAt={card.lastVerifiedAt}
          className="mt-auto pt-1"
        />
      </div>
      <div className="flex min-h-[60px] items-center justify-between gap-3 border-t px-4 py-3">
        <OfferLine card={card} market={market} />
        <CompareToggle
          item={{
            slug: card.slug,
            name: card.name,
            brandName: card.brand.name,
            href: card.href,
            topCategorySlug: card.topCategory.slug,
            topCategoryName: card.topCategory.name,
            icon: card.category.icon,
          }}
        />
      </div>
    </Blueprint>
  );
}

export function ProductGrid({
  cards,
  market,
  headingLevel,
}: {
  cards: ProductCardData[];
  market: string;
  headingLevel?: 2 | 3;
}) {
  return (
    <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {cards.map((c) => (
        <li key={c.id}>
          <ProductCard card={c} market={market} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}
