import { describe, expect, it } from "vitest";
import { DOCS_ORDER, checkDocsCompleteness, firstH1 } from "@/lib/docsNav";

describe("docsNav", () => {
  it("lists all eight doc slugs in reading order", () => {
    expect(DOCS_ORDER).toEqual([
      "getting-started", "cli-reference", "configuration", "tui-guide",
      "skills-and-mcp", "print-mode", "theming-and-branding", "lcp-protocol",
    ]);
  });
  it("accepts an exactly matching file set", () => {
    expect(() => checkDocsCompleteness(DOCS_ORDER.map((s) => `${s}.md`))).not.toThrow();
  });
  it("throws when a file is missing", () => {
    const files = DOCS_ORDER.filter((s) => s !== "print-mode").map((s) => `${s}.md`);
    expect(() => checkDocsCompleteness(files)).toThrow(/missing: print-mode/);
  });
  it("throws on an unexpected extra file", () => {
    expect(() => checkDocsCompleteness([...DOCS_ORDER.map((s) => `${s}.md`), "extra.md"]))
      .toThrow(/unexpected: extra/);
  });
  it("firstH1 extracts the first markdown H1", () => {
    expect(firstH1("intro text\n\n# CLI reference\n\nbody")).toBe("CLI reference");
  });
  it("firstH1 throws when there is no H1", () => {
    expect(() => firstH1("## only h2")).toThrow(/no H1/);
  });
});
