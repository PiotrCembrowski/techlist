import type { Metadata } from "next";
import { getIndexability } from "@/modules/seo/indexability";
import { pageMetadata } from "@/modules/seo/metadata";
import Link from "next/link";
import { CategoryIcon } from "@/components/product/image-placeholder";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container } from "@/components/ui/section";
import { getDb } from "@/lib/db";
import { getCategoryTree } from "@/modules/catalog/pages";

export async function generateMetadata(): Promise<Metadata> {
  const itemCount = (await getCategoryTree(getDb())).length;
  return pageMetadata({
    title: "Categories",
    description: "Every product category, with its subcategories.",
    path: "/categories",
    indexability: getIndexability({ kind: "listing", filtered: false, itemCount }),
  });
}

export default async function CategoriesIndex() {
  const tree = await getCategoryTree(getDb());
  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-3">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Categories" }]} />
        <h1 className="text-5xl">Categories</h1>
      </div>
      {tree.length ? (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {tree.map((c) => (
            <li key={c.slug} className="blueprint flex flex-col gap-3 p-5">
              <Link
                href={`/categories/${c.slug}`}
                className="flex items-center gap-3 font-heading text-2xl font-semibold hover:text-primary"
              >
                <CategoryIcon name={c.icon} className="size-6 text-primary" />
                {c.name}
              </Link>
              <span className="text-sm text-muted-foreground">{c.productCount} products</span>
              {c.children.length ? (
                <ul className="flex flex-col gap-1 border-t pt-3 text-sm">
                  {c.children.map((ch) => (
                    <li key={ch.slug} className="flex justify-between">
                      <Link
                        href={`/categories/${ch.slug}`}
                        className="text-primary hover:text-primary-active"
                      >
                        {ch.name}
                      </Link>
                      <span className="text-xs text-muted-foreground">{ch.productCount}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No categories have been published yet.</p>
      )}
    </Container>
  );
}
