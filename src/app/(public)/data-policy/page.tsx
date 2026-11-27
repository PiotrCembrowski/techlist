import { ShieldAlert, ShieldCheck } from "lucide-react";
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
      intro="Where specifications come from, and how they are checked."
    >
      <h2 id="verification">Verification</h2>
      <p>
        Every product goes through review before it is published. Products imported from data
        providers start as &ldquo;needs review&rdquo; and only appear here after an editor has
        checked them.
      </p>
      <dl className="flex flex-col gap-3">
        <div className="border-t pt-3">
          <dt className="flex items-center gap-2 font-medium text-verified">
            <ShieldCheck aria-hidden="true" strokeWidth={1.5} className="size-4" /> Verified
          </dt>
          <dd className="text-muted-foreground">
            A person has checked the product&rsquo;s data against its sources. The date shows when.
            Individual values still awaiting a source are marked &ldquo;unverified&rdquo;.
          </dd>
        </div>
        <div className="border-t pt-3">
          <dt className="flex items-center gap-2 font-medium text-warning">
            <ShieldAlert aria-hidden="true" strokeWidth={1.5} className="size-4" /> Not verified yet
          </dt>
          <dd className="text-muted-foreground">
            The product was published before a full check, for example a newly announced product.
            Its data may be incomplete or preliminary.
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
        page lists its sources, when they were retrieved, the licence they are used under and any
        notice that licence requires.
      </p>
      <p>
        When data is imported from a provider, we convert units to the ones shown here and tidy
        text: extra spaces and HTML are removed, the brand is not repeated in the product name, and
        options use our standard spelling. The product page says so for each imported source, with
        the date, and we keep the values exactly as the provider sent them.
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
