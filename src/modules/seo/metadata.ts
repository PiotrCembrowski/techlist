import type { Metadata } from "next";
import { getEnv } from "@/config/env";
import { siteConfig } from "@/config/site";
import type { Indexability } from "./indexability";

/**
 * Robots metadata for a page. With demo data enabled the whole site is `noindex, nofollow`
 * (rule 2.1.2) regardless of the page's own rule.
 */
export function robotsFor(ix: Indexability): Metadata["robots"] {
  if (getEnv().ENABLE_DEMO_DATA) return { index: false, follow: false };
  return { index: ix.index, follow: ix.follow };
}

/** Title, description, canonical, robots, Open Graph and Twitter in one place. */
export function pageMetadata(o: {
  title: string;
  description: string;
  path: string;
  indexability: Indexability;
  type?: "website" | "article";
  images?: { url: string; alt: string }[];
}): Metadata {
  const description =
    o.description.length > 300 ? `${o.description.slice(0, 297)}…` : o.description;
  return {
    title: o.title,
    description,
    alternates: { canonical: o.path },
    robots: robotsFor(o.indexability),
    openGraph: {
      title: o.title,
      description,
      url: o.path,
      siteName: siteConfig.name,
      type: o.type ?? "website",
      ...(o.images?.length ? { images: o.images } : {}),
    },
    twitter: {
      card: o.images?.length ? "summary_large_image" : "summary",
      title: o.title,
      description,
    },
  };
}

/** Structured data only on indexable pages, and never while demo data is enabled (rule 2.1.2). */
export function emitsStructuredData(ix: Indexability): boolean {
  return ix.index && !getEnv().ENABLE_DEMO_DATA;
}
