import type { Metadata } from "next";
import Link from "next/link";
import { StaticPage } from "@/components/content/static-page";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = { title: "About", alternates: { canonical: "/about" } };

export default function AboutPage() {
  return (
    <StaticPage
      title={`About ${siteConfig.name}`}
      intro="A reference for technology specifications: structured, sourced and dated."
    >
      <p>
        {siteConfig.name} records the specifications of phones, laptops, processors, graphics cards,
        monitors and headphones in a consistent structure, so products can be compared value by
        value.
      </p>
      <h2>What we do not do</h2>
      <ul>
        <li>No ratings, scores, review counts or overall &ldquo;winners&rdquo;.</li>
        <li>
          No converted prices: every price is shown in the currency the retailer listed it in.
        </li>
        <li>No invented data: where we have no value, we say &ldquo;Not available&rdquo;.</li>
      </ul>
      <h2>Where the data comes from</h2>
      <p>
        Every product shows its sources and verification status. Read the{" "}
        <Link href="/data-policy" className="text-primary">
          data and verification policy
        </Link>{" "}
        for details, and the{" "}
        <Link href="/affiliate-disclosure" className="text-primary">
          affiliate disclosure
        </Link>{" "}
        for how the site is funded.
      </p>
    </StaticPage>
  );
}
