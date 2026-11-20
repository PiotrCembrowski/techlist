import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { CompareTray } from "@/components/compare/compare-tray";
import { DemoBanner } from "@/components/layout/demo-banner";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { getEnv } from "@/config/env";
import { siteConfig } from "@/config/site";

export function generateMetadata(): Metadata {
  const env = getEnv();
  return {
    metadataBase: new URL(env.SITE_URL),
    title: {
      default: `${siteConfig.name} — ${siteConfig.tagline}`,
      template: `%s · ${siteConfig.name}`,
    },
    description: siteConfig.description,
    // Demo data must never be indexed (rule 2.1.2).
    robots: env.ENABLE_DEMO_DATA ? { index: false, follow: false } : undefined,
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f3" },
    { media: "(prefers-color-scheme: dark)", color: "#1d1f20" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const demo = getEnv().ENABLE_DEMO_DATA;
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col">
        <ThemeProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:px-3 focus:py-2"
          >
            Skip to content
          </a>
          {demo ? <DemoBanner /> : null}
          <SiteHeader />
          <main id="main" className="flex flex-1 flex-col">
            {children}
          </main>
          <SiteFooter demo={demo} />
          <CompareTray />
        </ThemeProvider>
      </body>
    </html>
  );
}
