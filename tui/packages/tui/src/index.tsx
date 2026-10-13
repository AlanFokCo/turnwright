/** turnwright TUI entry: resolve engine, wire LCP, render the app. */

import React from "react";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { EngineClient } from "@turnwright/core";
import { App } from "./App.js";

export function resolveEnginePath(): string {
  if (process.env.TURNWRIGHT_ENGINE && existsSync(process.env.TURNWRIGHT_ENGINE)) {
    return process.env.TURNWRIGHT_ENGINE;
  }
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "turnwright-engine");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  const pkg = `@turnwright/engine-${process.platform}-${process.arch}`;
  try {
    const bin = createRequire(import.meta.url).resolve(`${pkg}/bin/turnwright-engine`);
    if (existsSync(bin)) return bin;
  } catch {
    // fall through to PATH
  }
  return "turnwright-engine";
}

export function parseArgs(argv: string[]): { resume: string | null; engineArgs: string[]; noAnim: boolean } {
  let resume: string | null = null;
  let noAnim = false;
  const engineArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--resume" && argv[i + 1]) {
      resume = argv[++i]!;
    } else if (a === "--continue") {
      resume = "continue";
    } else if (a === "--no-anim") {
      noAnim = true;
    } else {
      engineArgs.push(a);
    }
  }
  return { resume, engineArgs, noAnim };
}

async function main() {
  const t0 = performance.now();
  const timing = process.env.TURNWRIGHT_TIMING ? (mark: string) =>
    process.stderr.write(`[timing] ${mark}: ${(performance.now() - t0).toFixed(1)}ms\n`) : () => {};
  const { resume, engineArgs, noAnim } = parseArgs(process.argv.slice(2));
  // spawn the engine first so its process boot overlaps renderer setup
  const client = new EngineClient({ enginePath: resolveEnginePath(), engineArgs });
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const root = createRoot(renderer);
  // paint something immediately; the real app replaces it when the engine answers
  root.render(
    <box width="100%" height="100%" padding={1}>
      <text fg="#6B7280">◆ starting engine…</text>
    </box>,
  );
  timing("splash paint");
  const info = await client.info;
  timing("engine initialize");
  root.render(
    <App client={client} info={info} resume={resume} noAnim={noAnim} />,
  );
  await new Promise((r) => setImmediate(r));
  timing("first render");
}

main().catch((e) => {
  console.error("turnwright:", e.message ?? e);
  process.exit(1);
});
