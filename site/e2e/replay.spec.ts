import { expect, test } from "@playwright/test";

test("JS disabled: poster frame communicates the product", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto("/turnwright/");
  const poster = page.locator(".player-static").first();
  await expect(poster).toBeVisible();
  await expect(poster).toContainText("turnwright");
  await expect(poster).toContainText("JS required to play");
  await ctx.close();
});

test("reduced motion: no autoplay", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/turnwright/");
  const player = page.locator("[data-player]").first();
  await expect(player).toHaveAttribute("data-playing", "false", { timeout: 5000 });
  await ctx.close();
});

test("controls: autoplay runs, pause/play toggle, scrub seeks", async ({ page }) => {
  await page.goto("/turnwright/");
  const player = page.locator("[data-player]").first();
  // hero autoplays under normal motion
  await expect(player).toHaveAttribute("data-playing", "true");
  await player.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(player).toHaveAttribute("data-playing", "false");
  await player.getByRole("button", { name: "Play", exact: true }).click();
  await expect(player).toHaveAttribute("data-playing", "true");
  const scrub = player.getByRole("slider");
  await scrub.fill("5000");
  await expect(player.locator(".entry")).not.toHaveCount(0);
});
