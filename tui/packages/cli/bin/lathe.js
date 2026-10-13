#!/usr/bin/env node
/** lathe launcher: resolve the Go engine + run the TUI (bun runtime). */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function resolveEngine() {
  if (process.env.LATHE_ENGINE && existsSync(process.env.LATHE_ENGINE)) {
    return process.env.LATHE_ENGINE;
  }
  // dev checkout: engine binary at repo root
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const dev = join(dir, "lathe-engine");
    if (existsSync(dev)) return dev;
    dir = dirname(dir);
  }
  // installed: per-platform engine package via optionalDependencies
  const pkg = `@lathe/engine-${process.platform}-${process.arch}`;
  try {
    const bin = import.meta.resolve(`${pkg}/bin/lathe-engine`);
    if (bin) return fileURLToPath(bin);
  } catch {}
  return "lathe-engine"; // PATH fallback
}

function resolveTuiEntry() {
  // installed: bundled TUI shipped inside @lathe/cli
  const bundled = join(here, "..", "dist", "tui.js");
  if (existsSync(bundled)) return bundled;
  // dev checkout: run from source
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const src = join(dir, "tui/packages/tui/src/index.tsx");
    if (existsSync(src)) return src;
    dir = dirname(dir);
  }
  return null;
}

const engine = resolveEngine();
const tuiEntry = resolveTuiEntry();
if (!tuiEntry) {
  console.error("lathe: cannot locate the TUI bundle. Reinstall @lathe/cli.");
  process.exit(1);
}

const child = spawn("bun", [tuiEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, LATHE_ENGINE: engine },
});
child.on("exit", (code) => process.exit(code ?? 0));
