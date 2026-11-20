import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PUBLIC_PAGES = [
  "/",
  "/products",
  "/categories",
  "/categories/laptops",
  "/brands/novik",
  "/products/novik/aera-7-pro",
  "/compare/aera-6-pro-vs-aera-7-pro",
  "/search?q=aera",
  "/guides",
  "/guides/how-much-phone-storage",
  "/about",
  "/products/novik/hush-4/suggest-correction",
  "/does-not-exist",
  "/admin/login",
];

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = results.violations.map(
    (v) => `${label}: ${v.id} (${v.impact}) — ${v.nodes.length}× ${v.nodes[0]?.target.join(" ")}`,
  );
  return summary;
}

test.describe("Accessibility (axe, WCAG 2.1 A/AA)", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`public pages in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const problems: string[] = [];
      for (const path of PUBLIC_PAGES) {
        await page.goto(path);
        problems.push(...(await audit(page, `${scheme} ${path}`)));
      }
      expect(problems).toEqual([]);
    });
  }
});
