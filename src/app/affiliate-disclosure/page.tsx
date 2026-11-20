import type { Metadata } from "next";
import { StaticPage } from "@/components/content/static-page";
import { getEnv } from "@/config/env";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Affiliate disclosure",
  alternates: { canonical: "/affiliate-disclosure" },
};

export default function AffiliateDisclosurePage() {
  const hours = getEnv().OFFER_STALE_HOURS;
  const staleText =
    hours % 24 === 0 ? `${hours / 24} ${hours === 24 ? "day" : "days"}` : `${hours} hours`;
  return (
    <StaticPage
      title="Affiliate disclosure"
      intro="How retailer links work, and what they never change."
    >
      <p>
        Some links to retailers are affiliate links. If you buy something after following one,{" "}
        {siteConfig.name} may earn a commission from the retailer or an affiliate network. The price
        you pay is the same.
      </p>
      <h2>What commissions never affect</h2>
      <ul>
        <li>Which products we list, and which specifications we show.</li>
        <li>
          Which offers we list, and their order. Offers are ordered by price within your selected
          market.
        </li>
        <li>Verification status. It depends only on sources.</li>
      </ul>
      <h2>Freshness</h2>
      <p>
        Every offer shows when it was last checked. Offers not checked in the last {staleText} are
        marked as possibly out of date and are never used for &ldquo;lowest price&rdquo;.
      </p>
    </StaticPage>
  );
}
