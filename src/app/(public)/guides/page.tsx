import type { Metadata } from "next";
import { getIndexability } from "@/modules/seo/indexability";
import { pageMetadata } from "@/modules/seo/metadata";
import Link from "next/link";
import { DemoTag } from "@/components/product/demo-tag";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container } from "@/components/ui/section";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { listPublishedGuides } from "@/modules/guides/service";

export async function generateMetadata(): Promise<Metadata> {
  const itemCount = (await listPublishedGuides(getDb(), { limit: 48 })).filter(
    (g) => !g.isDemo,
  ).length;
  return pageMetadata({
    title: "Guides",
    description: "Practical guides to reading and comparing technology specifications.",
    path: "/guides",
    indexability: getIndexability({ kind: "listing", filtered: false, itemCount }),
  });
}

export default async function GuidesIndex() {
  const guides = await listPublishedGuides(getDb(), { limit: 48 });
  return (
    <Container className="flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-3">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Guides" }]} />
        <h1 className="text-5xl">Guides</h1>
      </div>
      {guides.length ? (
        <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {guides.map((g) => (
            <li key={g.slug}>
              <Link
                href={`/guides/${g.slug}`}
                className="blueprint flex h-full flex-col gap-2 p-5 hover:bg-accent"
              >
                <span className="flex items-center gap-2">
                  <span className="label-caps">{formatDate(g.publishedAt)}</span>
                  {g.isDemo ? <DemoTag /> : null}
                </span>
                <span className="font-heading text-2xl leading-tight font-semibold">{g.title}</span>
                {g.summary ? (
                  <span className="text-sm text-muted-foreground">{g.summary}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No guides have been published yet.</p>
      )}
    </Container>
  );
}
