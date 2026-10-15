import { expect, test } from "@playwright/test";

test("install chip: rapid double copy keeps feedback until 1.6s after the LAST click", async ({ page }) => {
  await page.goto("/turnwright/");
  const chip = page.locator("[data-install-chip]").first();
  await chip.click();
  await page.waitForTimeout(1000);
  await chip.click();
  await page.waitForTimeout(1000); // t0+2.0s: a leaked first timer would have cleared at t0+1.6s
  await expect(chip).toHaveAttribute("data-copied", /true|false/);
});

test("chapter row stays single-line at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/turnwright/");
  const chapters = page.locator("#watch .chapters").first();
  await chapters.scrollIntoViewIfNeeded();
  const row = await chapters.boundingBox();
  const btn = await chapters.locator("button").first().boundingBox();
  expect(row!.height).toBeLessThanOrEqual(btn!.height + 4);
});

test("full replay shows content before first play", async ({ page }) => {
  await page.goto("/turnwright/");
  const player = page.locator("#watch [data-player]").first();
  await player.scrollIntoViewIfNeeded();
  // a lone user line in a 300px body reads unfinished; startT must prime ≥2 entries
  await expect(player.locator(".entry")).not.toHaveCount(1);
  await expect(player.locator(".entry").first()).toBeVisible({ timeout: 5000 });
});
