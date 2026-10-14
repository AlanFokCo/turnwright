import { describe, expect, it } from "vitest";
import { inlineSrcNotes } from "@/lib/srcNotes";

describe("inlineSrcNotes", () => {
  it("converts src comments into marginalia asides", () => {
    const out = inlineSrcNotes("text\n<!-- src: internal/config/config.go pickDefaultModel -->\nmore");
    expect(out).toContain('<p class="src-note">');
    expect(out).toContain("internal/config/config.go pickDefaultModel");
    expect(out).not.toContain("<!--");
  });
  it("leaves ordinary HTML comments alone", () => {
    const src = "text\n<!-- just a comment -->\nmore";
    expect(inlineSrcNotes(src)).toContain("<!-- just a comment -->");
  });
  it("handles several notes in one document", () => {
    const out = inlineSrcNotes("<!-- src: a.go A -->\nx\n<!-- src: b.ts B -->");
    expect(out.match(/src-note/g)?.length).toBe(2);
  });
});
