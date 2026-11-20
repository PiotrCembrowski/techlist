import Link from "next/link";
import { Section } from "@/components/ui/section";
import type { FeaturedComparison } from "@/modules/comparisons/service";

/** Editor-curated comparisons (SPEC §5.2 featured_comparisons). */
export function FeaturedComparisons({
  items,
  title = "Featured comparisons",
}: {
  items: FeaturedComparison[];
  title?: string;
}) {
  return (
    <Section title={title} id="featured-comparisons">
      <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {items.map((f) => (
          <li key={f.path}>
            <Link
              href={f.path}
              className="blueprint flex h-full flex-col gap-2 p-5 hover:bg-accent"
            >
              <span className="font-heading text-xl leading-tight font-semibold">{f.title}</span>
              <span className="text-sm text-muted-foreground">
                {f.products.map((p) => `${p.brandName} ${p.name}`).join(" · ")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
