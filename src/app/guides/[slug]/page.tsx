import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { Markdown } from "@/components/content/markdown";
import { DemoTag } from "@/components/product/demo-tag";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container } from "@/components/ui/section";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { productHref } from "@/modules/catalog/service";
import { getPublishedGuide } from "@/modules/guides/service";

type Props = { params: Promise<{ slug: string }> };

const load = cache((slug: string) => getPublishedGuide(getDb(), slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await load((await params).slug);
  if (r.kind !== "ok") return {};
  const g = r.guide;
  return {
    title: g.seoTitle ?? g.title,
    description: g.seoDescription ?? g.summary ?? undefined,
    alternates: { canonical: `/guides/${g.slug}` },
    ...(g.isDemo ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function GuidePage({ params }: Props) {
  const r = await load((await params).slug);
  if (r.kind === "redirect") permanentRedirect(r.to);
  if (r.kind === "not_found") notFound();
  const g = r.guide;
  return (
    <Container className="flex flex-col gap-6 py-10">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Guides", href: "/guides" },
          { label: g.title },
        ]}
      />
      <article className="grid gap-10 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-8">
          <span className="flex items-center gap-3 text-sm text-muted-foreground">
            {formatDate(g.publishedAt)}
            {g.authorName ? ` · ${g.authorName}` : ""}
            {g.isDemo ? <DemoTag /> : null}
          </span>
          <h1 className="text-5xl">{g.title}</h1>
          {g.summary ? (
            <p className="max-w-[68ch] text-lg text-muted-foreground">{g.summary}</p>
          ) : null}
          <Markdown source={g.bodyMarkdown} />
        </div>
        {g.products.length || g.categories.length ? (
          <aside className="flex flex-col gap-6 lg:col-span-4">
            {g.products.length ? (
              <section
                aria-labelledby="guide-products"
                className="blueprint flex flex-col gap-2 p-5"
              >
                <h2 id="guide-products" className="text-xl">
                  Products in this guide
                </h2>
                {g.products.map((p) => (
                  <Link
                    key={p.slug}
                    href={productHref(p.brandSlug, p.slug)}
                    className="border-t pt-2 text-sm font-medium text-primary"
                  >
                    {p.brandName} {p.name}
                  </Link>
                ))}
              </section>
            ) : null}
            {g.categories.length ? (
              <section aria-labelledby="guide-categories" className="flex flex-col gap-2">
                <h2 id="guide-categories" className="label-caps">
                  Categories
                </h2>
                {g.categories.map((c) => (
                  <Link
                    key={c.slug}
                    href={`/categories/${c.slug}`}
                    className="text-sm text-primary"
                  >
                    {c.name}
                  </Link>
                ))}
              </section>
            ) : null}
          </aside>
        ) : null}
      </article>
    </Container>
  );
}
