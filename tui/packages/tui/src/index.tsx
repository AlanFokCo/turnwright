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
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "lathe-engine");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  const pkg = `@lathe/engine-${process.platform}-${process.arch}`;
  try {
    const bin = createRequire(import.meta.url).resolve(`${pkg}/bin/lathe-engine`);
    if (existsSync(bin)) return bin;
  } catch {
    // fall through to PATH
  }
  return "lathe-engine";
}

export function parseArgs(argv: string[]): { resume: string | null; engineArgs: string[] } {
  let resume: string | null = null;
  const engineArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--resume" && argv[i + 1]) {
      resume = argv[++i]!;
    } else if (a === "--continue") {
      resume = "continue";
    } else {
      engineArgs.push(a);
    }
  }
  return { resume, engineArgs };
}

async function main() {
  const { resume, engineArgs } = parseArgs(process.argv.slice(2));
  const client = new EngineClient({ enginePath: resolveEnginePath(), engineArgs });
  const info = await client.info;
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  createRoot(renderer).render(
    <App client={client} info={info} resume={resume} />,
  );
}

main().catch((e) => {
  console.error("lathe:", e.message ?? e);
  process.exit(1);
});
