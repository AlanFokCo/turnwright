/** Lighthouse gate: run against a local preview of the built site.
 *  Usage: node scripts/lighthouse.mjs [baseUrl]
 *  Exits non-zero when any gate fails:
 *    Perf/A11y/BestPractices/SEO >= 95, CLS < 0.05,
 *    LCP < 2000ms desktop / < 2500ms simulated mobile (Slow-4G + 4x CPU is a
 *    worst-case proxy; the interactive hero island costs ~750ms of main
 *    thread under it — see ledger ruling; real-world 4G ≈ 1.0-1.3s). */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const BASE = (process.argv[2] ?? "http://localhost:4321").replace(/\/$/, "");
const OUT = new URL("../.qa/lighthouse/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const targets = [
  ["home-mobile", `${BASE}/turnwright/`, "mobile"],
  ["home-desktop", `${BASE}/turnwright/`, "desktop"],
  ["docs-mobile", `${BASE}/turnwright/docs/tui-guide/`, "mobile"],
];

const GATES = {
  performance: 0.95,
  accessibility: 0.95,
  "best-practices": 0.95,
  seo: 0.95,
};

let failed = false;
for (const [name, url, preset] of targets) {
  // lighthouse: mobile is the default emulation; desktop is an opt-in preset
  const args = [
    "lighthouse", url,
    "--quiet", "--output=json", `--output-path=${new URL(`${name}.json`, OUT).pathname}`,
    ...(preset === "desktop" ? ["--preset=desktop"] : []),
    "--chrome-flags=--headless=new",
    "--only-categories=performance,accessibility,best-practices,seo",
  ];
  await new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", ...args], { stdio: "inherit", shell: false });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`lighthouse exited ${code} for ${name}`))));
  });
  const report = JSON.parse((await import("node:fs")).readFileSync(new URL(`${name}.json`, OUT), "utf8"));
  const lines = [];
  for (const [cat, min] of Object.entries(GATES)) {
    const score = Math.round((report.categories[cat]?.score ?? 0) * 100);
    const ok = score >= min * 100;
    if (!ok) failed = true;
    lines.push(`${cat}=${score}${ok ? "" : ` <${min * 100} FAIL`}`);
  }
  const lcp = report.audits["largest-contentful-paint"]?.numericValue ?? 0;
  const cls = report.audits["cumulative-layout-shift"]?.numericValue ?? 0;
  const lcpLimit = preset === "mobile" ? 2500 : 2000;
  const lcpOk = lcp < lcpLimit;
  const clsOk = cls < 0.05;
  if (!lcpOk || !clsOk) failed = true;
  lines.push(`LCP=${Math.round(lcp)}ms${lcpOk ? "" : " FAIL"}`, `CLS=${cls.toFixed(3)}${clsOk ? "" : " FAIL"}`);
  console.log(`${name}: ${lines.join(" ")}`);
}
process.exit(failed ? 1 : 0);
