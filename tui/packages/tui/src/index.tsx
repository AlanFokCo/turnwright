/** lathe TUI entry: resolve engine, wire LCP, render the app. */

import React from "react";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { EngineClient } from "@lathe/core";
import { App } from "./App.js";

export function resolveEnginePath(): string {
  if (process.env.LATHE_ENGINE && existsSync(process.env.LATHE_ENGINE)) {
    return process.env.LATHE_ENGINE;
  }
  // dev checkout: walk up from this file looking for the repo-root binary
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "lathe-engine");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  // packaged: per-platform optional dependency
  const pkg = `@lathe/engine-${process.platform}-${process.arch}`;
  try {
    const bin = createRequire(import.meta.url).resolve(`${pkg}/bin/lathe-engine`);
    if (existsSync(bin)) return bin;
  } catch {
    // fall through
  }
  return "lathe-engine"; // PATH lookup
}

async function main() {
  const client = new EngineClient({ enginePath: resolveEnginePath() });
  const info = await client.info;
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  createRoot(renderer).render(
    <App client={client} brand={info.brand} model={info.model} />,
  );
}

main().catch((e) => {
  console.error("lathe:", e.message ?? e);
  process.exit(1);
});
