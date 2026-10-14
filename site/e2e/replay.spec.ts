import { expect, test } from "@playwright/test";

test("JS disabled: settled state shows the SSR frame plus an explanation", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto("/turnwright/");
  await page.waitForTimeout(2000); // settled: hydration cannot occur
  // the server-rendered player frame is the JS-off visual…
  const frame = page.locator(".hero-stage .player").first();
  await expect(frame).toBeVisible();
  await expect(frame).toContainText("turnwright session");
  // …and every stage explains why nothing moves
  const notes = page.locator(".js-note");
  expect(await notes.count()).toBeGreaterThanOrEqual(2);
  for (const note of await notes.all()) {
    await expect(note).toBeVisible();
    await expect(note).toContainText("JS required to play");
  }
  // …unoccluded: the note must be the topmost element at its own center
  const topmost = await page.evaluate(() => {
    const note = document.querySelector(".hero-stage .js-note");
    if (!note) return "missing";
    const r = note.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return note === el || note.contains(el) ? "note" : `occluded-by:${el?.className ?? "unknown"}`;
  });
  expect(topmost).toBe("note");
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
