import { describe, expect, it } from "vitest";
import { DOC_LINK_RE, rewriteDocLinks } from "@/lib/docLinks";

const wrap = (href: string) => `<p><a href="${href}">x</a></p>`;

describe("rewriteDocLinks", () => {
  it("rewrites ./relative.md to the site route", () => {
    expect(rewriteDocLinks(wrap("./configuration.md")))
      .toContain('href="/turnwright/docs/configuration/"');
  });
  it("rewrites bare relative.md", () => {
    expect(rewriteDocLinks(wrap("tui-guide.md")))
      .toContain('href="/turnwright/docs/tui-guide/"');
  });
  it("preserves anchors", () => {
    expect(rewriteDocLinks(wrap("./tui-guide.md#permission-modes")))
      .toContain('href="/turnwright/docs/tui-guide/#permission-modes"');
  });
  it("leaves external URLs untouched", () => {
    const html = wrap("https://github.com/agentscope-ai/agentscope-go");
    expect(rewriteDocLinks(html)).toBe(html);
  });
  it("leaves root-relative and anchor-only links untouched", () => {
    expect(rewriteDocLinks(wrap("/turnwright/docs/"))).toBe(wrap("/turnwright/docs/"));
    expect(rewriteDocLinks(wrap("#usage"))).toBe(wrap("#usage"));
  });
  it("rewrites multiple links in one document", () => {
    const html = wrap("./a.md") + wrap("b.md#sec");
    const out = rewriteDocLinks(html);
    expect(out).toContain('href="/turnwright/docs/a/"');
    expect(out).toContain('href="/turnwright/docs/b/#sec"');
  });
});

describe("DOC_LINK_RE (shared with rehype plugin)", () => {
  it("matches the same shapes as the string rewriter", () => {
    expect("./a.md#b".match(DOC_LINK_RE)?.slice(1)).toEqual(["a", "#b"]);
    expect("https://x/a.md".match(DOC_LINK_RE)).toBeNull();
  });
});
