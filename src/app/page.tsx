import { connection } from "next/server";
import { Blueprint } from "@/components/ui/blueprint";
import { getDb } from "@/lib/db";
import { getCatalogStats } from "@/modules/stats/service";

const nf = new Intl.NumberFormat("en-GB");

export default async function HomePage() {
  await connection(); // live counts: render per request
  const stats = await getCatalogStats(getDb());
  const cells = [
    { label: "Products", value: stats.products },
    { label: "Brands", value: stats.brands },
    { label: "Markets", value: stats.markets },
    { label: "Verified · 7 days", value: stats.verifiedLast7Days },
  ];
  const today = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date())
    .toUpperCase();

  return (
    <section aria-labelledby="hero-title" className="border-b">
      <div className="drafting-grid mx-auto grid max-w-[1280px] gap-10 px-4 pt-16 pb-14 sm:px-6 md:pt-20 lg:grid-cols-12 lg:gap-6 lg:px-10">
        <div className="flex flex-col gap-5 lg:col-span-8">
          <span className="text-xs font-medium tracking-[0.12em] text-primary uppercase">
            Global technology product database
          </span>
          <h1
            id="hero-title"
            className="text-5xl leading-[0.98] tracking-[-0.02em] sm:text-6xl lg:text-[76px]"
          >
            Discover. Compare. Choose smarter.
          </h1>
          <p className="max-w-[600px] text-lg text-pretty text-muted-foreground">
            Explore technology products, compare specifications and find offers from retailers
            around the world.
          </p>
        </div>
        <Blueprint
          as="aside"
          aria-label="Catalogue index"
          className="self-end bg-background lg:col-span-4"
        >
          <div className="flex justify-between border-b px-4 py-2.5 font-heading text-[13px] font-semibold tracking-[0.1em]">
            <span>INDEX</span>
            <span className="text-muted-foreground">REV. {today}</span>
          </div>
          <dl className="grid grid-cols-2">
            {cells.map((c, i) => (
              <div
                key={c.label}
                className={`p-4 ${i % 2 === 0 ? "border-r" : ""} ${i < 2 ? "border-b" : ""}`}
              >
                <dt className="label-caps">{c.label}</dt>
                <dd className="font-heading text-[40px] leading-[1.05] font-semibold">
                  {nf.format(c.value)}
                </dd>
              </div>
            ))}
          </dl>
        </Blueprint>
      </div>
    </section>
  );
}
