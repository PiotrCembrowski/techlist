import type { Metadata } from "next";
import { StaticPage } from "@/components/content/static-page";

export const metadata: Metadata = { title: "Privacy", alternates: { canonical: "/privacy" } };

export default function PrivacyPage() {
  return (
    <StaticPage title="Privacy" intro="What this site stores, and what it does not.">
      <h2>No accounts, no tracking scripts</h2>
      <p>
        There is no public registration and no third-party analytics or advertising script on this
        site.
      </p>
      <h2>Cookies and local storage</h2>
      <ul>
        <li>
          <strong>market</strong> (cookie, 1 year): the market you selected, so offers for that
          country are shown first. It is not set unless you choose a market; we do not detect your
          location.
        </li>
        <li>
          <strong>theme</strong> (your browser&rsquo;s local storage): light or dark mode.
        </li>
      </ul>
      <h2>Search suggestions</h2>
      <p>
        To protect the service from abuse, suggestion requests are counted per network address for
        one minute. The address is stored only as a one-way hash, and counters are deleted within a
        day.
      </p>
      <h2>Retailer links</h2>
      <p>
        When you follow a retailer link we record the time, the offer, your selected market and the
        referring site&rsquo;s host name, and whether the request looked automated. We do not record
        IP addresses, full URLs or browser identifiers.
      </p>
    </StaticPage>
  );
}
