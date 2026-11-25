import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { adminLogin } from "./helpers";

// Runs in the admin projects (file name matches journey-d*): the admin is created in global setup.
const ADMIN_PAGES = [
  "/admin",
  "/admin/products",
  "/admin/products/new",
  "/admin/categories",
  "/admin/offers",
  "/admin/imports",
  "/admin/review",
  "/admin/audit",
];

test("admin pages pass axe (WCAG 2.1 A/AA)", async ({ page }) => {
  await adminLogin(page);
  const problems: string[] = [];
  for (const path of ADMIN_PAGES) {
    await page.goto(path);
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    problems.push(
      ...r.violations.map(
        (v) =>
          `${path}: ${v.id} (${v.impact}) — ${v.nodes.length}× ${v.nodes[0]?.target.join(" ")}`,
      ),
    );
  }
  // Product edit page, reached through the list.
  await page.goto("/admin/products");
  await page.getByRole("link", { name: "Aera 7 Pro", exact: true }).click();
  // Client-side navigation: wait for the new page (and its title) before auditing.
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
  await expect(page).toHaveTitle(/Edit product/);
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  problems.push(
    ...r.violations.map(
      (v) =>
        `product edit: ${v.id} (${v.impact}) — ${v.nodes.length}× ${v.nodes[0]?.target.join(" ")}`,
    ),
  );
  expect(problems).toEqual([]);
});
