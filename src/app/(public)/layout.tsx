import type { ReactNode } from "react";
import { CompareTray } from "@/components/compare/compare-tray";
import { DemoBanner } from "@/components/layout/demo-banner";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SkipLink } from "@/components/layout/skip-link";
import { getEnv } from "@/config/env";

/** Public site chrome: demo banner, header, footer and the floating comparison tray. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  const demo = getEnv().ENABLE_DEMO_DATA;
  return (
    <>
      <SkipLink />
      {demo ? <DemoBanner /> : null}
      <SiteHeader />
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
      <SiteFooter demo={demo} />
      <CompareTray />
    </>
  );
}
