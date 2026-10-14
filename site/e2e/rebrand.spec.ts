import { expect, test } from "@playwright/test";

test("rebrand demo: inputs repaint the preview and update the TOML", async ({ page }) => {
  await page.goto("/turnwright/");
  const demo = page.locator("[data-rebrand]").first();
  await demo.scrollIntoViewIfNeeded();
  await demo.getByLabel("Accent hex value").waitFor(); // hydrated

  await demo.getByLabel("Accent hex value", { exact: true }).fill("#12B886");
  const mini = demo.locator(".mini-status .mini-brand");
  await expect(mini).toHaveCSS("color", "rgb(18, 184, 134)");

  await demo.locator("input").first().fill("lathebot");
  await expect(mini).toHaveText("lathebot");
  await expect(demo.locator("pre")).toContainText('name    = "lathebot"');
  await expect(demo.locator("pre")).toContainText('accent  = "#12B886"');

  await demo.getByLabel("Accent hex value", { exact: true }).fill("nothex");
  await expect(demo).toContainText("not a hex color");
});
