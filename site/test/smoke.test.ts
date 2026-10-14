import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "../src/styles/global.css"), "utf8");

describe("design tokens", () => {
  it("defines the exact spec palette", () => {
    for (const [name, hex] of [
      ["--bg", "#0e0f13"], ["--surface", "#16181f"], ["--text", "#e7e9ee"],
      ["--muted", "#6b7280"], ["--accent", "#f59e0b"], ["--success", "#34d399"],
      ["--warn", "#fbbf24"], ["--danger", "#f87171"], ["--info", "#60a5fa"],
      ["--border", "#2a2e3a"], ["--selection", "#2e3344"],
    ] as const) {
      expect(css, `${name} must be ${hex}`).toContain(`${name}: ${hex}`);
    }
  });
  it("gates all motion behind prefers-reduced-motion", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
  it("uses the machine easing token", () => {
    expect(css).toContain("--ease-machine: cubic-bezier(0.2, 0.8, 0.2, 1)");
  });
});
