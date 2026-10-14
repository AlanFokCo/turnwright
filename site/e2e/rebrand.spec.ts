import { expect, test } from "@playwright/test";

test("rebrand demo: inputs repaint the preview and update the TOML", async ({ page }) => {
  await page.goto("/turnwright/");
  const demo = page.locator("[data-rebrand]").first();
  await demo.scrollIntoViewIfNeeded();
  await demo.getByLabel("Accent hex value").waitFor(); // hydrated

  const hex = demo.getByLabel("Accent hex value", { exact: true });
  await hex.click({ clickCount: 3 });
  await hex.pressSequentially("#12B886", { delay: 15 });
  const mini = demo.locator(".mini-status .mini-brand");
  await expect(mini).toHaveCSS("color", "rgb(18, 184, 134)");

  const nameInput = demo.locator("input").first();
  await nameInput.click({ clickCount: 3 });
  await nameInput.pressSequentially("lathebot", { delay: 15 });
  await expect(mini).toHaveText("lathebot");
  await expect(demo.locator("pre")).toContainText('name    = "lathebot"');
  await expect(demo.locator("pre")).toContainText('accent  = "#12B886"');

  await hex.click({ clickCount: 3 });
  await hex.pressSequentially("nothex", { delay: 15 });
  await expect(demo).toContainText("not a hex color");
});
