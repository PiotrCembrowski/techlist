import { ShieldAlert, ShieldCheck, ShieldHalf } from "lucide-react";
import type { Metadata } from "next";
import { getIndexability } from "@/modules/seo/indexability";
import { pageMetadata } from "@/modules/seo/metadata";
import { StaticPage } from "@/components/content/static-page";
import { NotAvailable } from "@/components/product/spec-table";

export function generateMetadata(): Metadata {
  return pageMetadata({
    title: "Data & verification policy",
    description:
      "Where our specification data comes from, how values are verified and how to correct them.",
    path: "/data-policy",
    indexability: getIndexability({ kind: "content" }),
  });
}

export default function DataPolicyPage() {
  return (
    <StaticPage
      title="Data & verification policy"
      intro="Where specifications come from, and what each verification status means."
    >
      <h2 id="verification">Verification statuses</h2>
      <dl className="flex flex-col gap-3">
        <div className="border-t pt-3">
          <dt className="flex items-center gap-2 font-medium text-verified">
            <ShieldCheck aria-hidden="true" strokeWidth={1.5} className="size-4" /> Verified
          </dt>
          <dd className="text-muted-foreground">
            Every key value has been matched to a source by a person. The date shows when.
          </dd>
        </div>
        <div className="border-t pt-3">
          <dt className="flex items-center gap-2 font-medium">
            <ShieldHalf aria-hidden="true" strokeWidth={1.5} className="size-4" /> Partially
            verified
          </dt>
          <dd className="text-muted-foreground">
            Some values are still awaiting a source. Those values are marked
            &ldquo;unverified&rdquo;.
          </dd>
        </div>
        <div className="border-t pt-3">
          <dt className="flex items-center gap-2 font-medium text-warning">
            <ShieldAlert aria-hidden="true" strokeWidth={1.5} className="size-4" /> Needs review
          </dt>
          <dd className="text-muted-foreground">
            The data may be incomplete or preliminary, for example for announced products.
          </dd>
        </div>
      </dl>

      <h2>Missing values</h2>
      <p>
        &ldquo;No&rdquo; means the product is confirmed not to have a feature. <NotAvailable />{" "}
        means we do not have the value. We never fill gaps with guesses.
      </p>

      <h2>Sources</h2>
      <p>
        In order of preference: manufacturer documentation, licensed data providers, approved
        affiliate and retailer feeds, manual research, AI-assisted extraction (always reviewed by a
        person before it can be marked verified) and community corrections (reviewed). Each product
        page lists its sources and when they were retrieved.
      </p>
      <p>
        A verified value is never overwritten automatically by lower-confidence data; changes go to
        a review queue first. We only use sources whose terms permit it, and do not scrape websites.
      </p>

      <h2>Units</h2>
      <p>
        Values are stored in one unit per specification (for example storage in GB with 1 TB = 1000
        GB) so products compare correctly.
      </p>
    </StaticPage>
  );
}
