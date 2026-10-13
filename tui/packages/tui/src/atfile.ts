/** @file references: expand `@path` mentions into fenced file contents before
 *  the prompt leaves the TUI, and complete paths while typing. */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const MAX_FILE_BYTES = 64 * 1024;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__"]);

const AT_RE = /(?:^|\s)@([^\s@]+)/g;

/** Expands @path mentions; returns the prompt plus appended file blocks. */
export function expandAtFiles(text: string, cwd: string): { text: string; missing: string[] } {
  const missing: string[] = [];
  const files: { path: string; content: string }[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(AT_RE)) {
    const raw = m[1];
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const abs = resolve(cwd, raw);
    try {
      const st = statSync(abs);
      if (!st.isFile()) {
        missing.push(raw);
        continue;
      }
      if (st.size > MAX_FILE_BYTES) {
        missing.push(`${raw} (>64KB)`);
        continue;
      }
      files.push({ path: raw, content: readFileSync(abs, "utf8") });
    } catch {
      missing.push(raw);
    }
  }
  if (files.length === 0) return { text, missing };
  const blocks = files
    .map((f) => `<file path="${f.path}">\n${f.content}\n</file>`)
    .join("\n");
  return { text: `${text}\n\n${blocks}`, missing };
}

/** Completes a partial @path against the workspace (depth-capped walk). */
export function completeAtPath(prefix: string, cwd: string, limit = 20): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || out.length >= limit) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.name.startsWith(".") && e.name !== ".turnwright") continue;
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
      const abs = join(dir, e.name);
      const rel = relative(cwd, abs);
      if (rel.toLowerCase().startsWith(prefix.toLowerCase())) {
        out.push(e.isDirectory() ? rel + "/" : rel);
      }
      if (e.isDirectory()) walk(abs, depth + 1);
    }
  };
  walk(cwd, 0);
  return out;
}
