import type { Metadata } from "next";
import { getIndexability } from "@/modules/seo/indexability";
import { pageMetadata } from "@/modules/seo/metadata";
import { countBrandsWithIndexableProducts } from "@/modules/seo/queries";
import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container } from "@/components/ui/section";
import { getDb } from "@/lib/db";
import { marketName } from "@/lib/format";
import { listBrandsByProductCount } from "@/modules/catalog/pages";

export async function generateMetadata(): Promise<Metadata> {
  const itemCount = await countBrandsWithIndexableProducts(getDb());
  return pageMetadata({
    title: "Brands",
    description: "Brands in the catalogue, by number of products.",
    path: "/brands",
    indexability: getIndexability({ kind: "listing", filtered: false, itemCount }),
  });
}

export default async function BrandsIndex() {
  const brands = await listBrandsByProductCount(getDb(), 200);
  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-3">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Brands" }]} />
        <h1 className="text-5xl">Brands</h1>
      </div>
      {brands.length ? (
        <ul className="grid grid-cols-1 border-t border-l sm:grid-cols-2 lg:grid-cols-4">
          {brands.map((b) => (
            <li key={b.slug} className="border-r border-b">
              <Link
                href={`/brands/${b.slug}`}
                className="flex h-full flex-col gap-1 p-5 hover:bg-accent"
              >
                <span className="font-heading text-2xl font-semibold tracking-[0.04em] uppercase">
                  {b.name}
                </span>
                <span className="text-sm text-muted-foreground">
                  {b.productCount} products
                  {b.countryOfOrigin ? ` · ${marketName(b.countryOfOrigin)}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No brands with published products yet.</p>
      )}
    </Container>
  );
}
