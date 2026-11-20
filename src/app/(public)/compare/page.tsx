import type { Metadata } from "next";
import { CompareHome } from "@/components/compare/compare-client";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { FeaturedComparisons } from "@/components/compare/featured-comparisons";
import { Container } from "@/components/ui/section";
import { getDb } from "@/lib/db";
import { listFeaturedComparisons } from "@/modules/comparisons/service";

export const metadata: Metadata = {
  title: "Compare products",
  description: "Compare up to four products side by side, specification by specification.",
  alternates: { canonical: "/compare" },
  robots: { index: false, follow: true },
};

export default async function ComparePage() {
  const featured = await listFeaturedComparisons(getDb(), { limit: 6 });
  return (
    <>
      <Container className="flex flex-col gap-6 py-10">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Compare" }]} />
        <h1 className="text-5xl">Compare products</h1>
        <p className="max-w-[68ch] text-muted-foreground">
          Pick two to four products from the same category. Specifications appear side by side in
          the same units, with the differences highlighted.
        </p>
        <CompareHome />
      </Container>
      {featured.length ? <FeaturedComparisons items={featured} /> : null}
    </>
  );
}
