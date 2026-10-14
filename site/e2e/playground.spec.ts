import { expect, test } from "@playwright/test";

// The playground island is client:visible below the fold — wait for its
// hydration (hint chips only exist post-hydration) before interacting.
async function openPlayground(page: import("@playwright/test").Page) {
  await page.goto("/turnwright/");
  const term = page.locator("[data-playground]").first();
  await term.scrollIntoViewIfNeeded();
  await term.getByRole("button", { name: "/help", exact: true }).waitFor();
  await page.waitForTimeout(150); // let the island settle post-hydration
  return term;
}

/** Type like a human: real key events (fill()'s value injection races the
 *  island's first post-hydration renders). */
async function typeCommand(term: import("@playwright/test").Locator, page: import("@playwright/test").Page, text: string) {
  const input = term.getByPlaceholder(/type a command/);
  await input.click();
  await input.pressSequentially(text, { delay: 15 });
  await input.press("Enter");
  return input;
}

test("playground: /help lists, approval flow resolves, unknown command warns", async ({ page }) => {
  const term = await openPlayground(page);

  await typeCommand(term, page, "/help");
  await expect(term).toContainText("/model [name]");

  await typeCommand(term, page, "run tests");
  const allow = term.getByRole("button", { name: "y — allow once" });
  await expect(allow).toBeVisible({ timeout: 5000 });
  await allow.click();
  await expect(term).toContainText("ok");

  await typeCommand(term, page, "/nope");
  await expect(term).toContainText("unknown command: /nope");
});

test("playground: theme command flips the terminal chrome", async ({ page }) => {
  const term = await openPlayground(page);
  await typeCommand(term, page, "/theme turnwright-light");
  await expect(term).toHaveClass(/light/);
});
