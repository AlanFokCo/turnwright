import { expect, test } from "@playwright/test";

// The playground island is client:visible below the fold — wait for its
// hydration (hint chips only exist post-hydration) before interacting.
async function openPlayground(page: import("@playwright/test").Page) {
  await page.goto("/turnwright/");
  const term = page.locator("[data-playground]").first();
  await term.scrollIntoViewIfNeeded();
  await term.getByRole("button", { name: "/help", exact: true }).waitFor();
  return term;
}

test("playground: /help lists, approval flow resolves, unknown command warns", async ({ page }) => {
  const term = await openPlayground(page);
  const input = term.getByPlaceholder(/type a command/);

  await input.fill("/help");
  await input.press("Enter");
  await expect(term).toContainText("/model [name]");

  await input.fill("run tests");
  await input.press("Enter");
  const allow = term.getByRole("button", { name: "y — allow once" });
  await expect(allow).toBeVisible({ timeout: 5000 });
  await allow.click();
  await expect(term).toContainText("ok");

  await input.fill("/nope");
  await input.press("Enter");
  await expect(term).toContainText("unknown command: /nope");
});

test("playground: theme command flips the terminal chrome", async ({ page }) => {
  const term = await openPlayground(page);
  const input = term.getByPlaceholder(/type a command/);
  await input.fill("/theme turnwright-light");
  await input.press("Enter");
  await expect(term).toHaveClass(/light/);
});
