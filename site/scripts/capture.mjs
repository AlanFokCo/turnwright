/** Screenshot harness: captures key pages/sections at desktop+mobile widths
 *  into site/.qa/ for visual review. Usage: node scripts/capture.mjs [baseUrl]
 *  Expects `astro preview` (or any static server for dist/) on the base URL. */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = (process.argv[2] ?? "http://localhost:4321/turnwright").replace(/\/$/, "");
const OUT = new URL("../.qa/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const viewports = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const targets = [
  ["home", "/"],
  ["docs-tui-guide", "/docs/tui-guide/"],
  ["docs-getting-started", "/docs/getting-started/"],
  ["notfound", "/404.html"],
];

const browser = await chromium.launch();
const shots = [];
for (const [vpName, viewport] of Object.entries(viewports)) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const [name, path] of targets) {
    const url = `${BASE}${path}`;
    await page.goto(url, { waitUntil: "networkidle" });
    // let reveals finish
    await page.evaluate(() => document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("in")));
    await page.waitForTimeout(300);
    const file = new URL(`${vpName}-${name}.png`, OUT);
    await page.screenshot({ path: file.pathname, fullPage: true });
    shots.push(file.pathname);
  }
  await ctx.close();
}
await browser.close();
console.log(shots.join("\n"));
