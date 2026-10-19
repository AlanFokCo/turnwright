/** Ground-truth probes for the markdown renderer: does <markdown> actually
 *  parse (backticks consumed), and does CJK text survive without inserted
 *  spacing? Regressions here are what users see as "markdown not rendered"
 *  and "Chinese characters spaced out". */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import React from "react";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { createRoot, type Root } from "@opentui/react";
import { useRenderer } from "@opentui/react";
import { makeMarkdownStyle } from "../src/markdown.js";
import { builtinTheme } from "../src/theme.js";

const SRC = "# 项目介绍 Title\n\n- item `code` 中文内容 contiguous";

function MarkdownProbe({ text }: { text: string }) {
  const renderer = useRenderer();
  const style = makeMarkdownStyle(renderer, builtinTheme("turnwright-dark"));
  if (!style) return <text>STYLE-NULL-FALLBACK {text}</text>;
  return <markdown content={text} syntaxStyle={style} />;
}

describe("markdown rendering", () => {
  let setup: TestRendererSetup;
  let root: Root;

  beforeEach(async () => {
    setup = await createTestRenderer({ width: 100, height: 24 });
    root = createRoot(setup.renderer);
  });
  afterEach(() => {
    root.unmount();
    void setup.dispose();
  });

  test("markdown is parsed (raw backticks consumed) and CJK stays contiguous", async () => {
    root.render(<MarkdownProbe text={SRC} />);
    for (let i = 0; i < 6; i++) await setup.renderOnce();
    await new Promise((r) => setTimeout(r, 50));
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).not.toContain("STYLE-NULL-FALLBACK");
    expect(frame).not.toContain("`code`");
    expect(frame).toContain("中文内容");
    expect(frame).not.toContain("中 文");
  });
});
