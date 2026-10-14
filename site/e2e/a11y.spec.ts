import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const pages = [
  "/turnwright/",
  "/turnwright/docs/getting-started/",
  "/turnwright/docs/tui-guide/",
  "/turnwright/404",
];

for (const url of pages) {
  test(`axe: ${url}`, async ({ page }) => {
    await page.goto(url);
    // measure the settled state: finish scroll-reveals so opacity no longer
    // dilutes contrast (reduced-motion users get this instantly)
    await page.evaluate(() => document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("in")));
    await page.waitForTimeout(700);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}
