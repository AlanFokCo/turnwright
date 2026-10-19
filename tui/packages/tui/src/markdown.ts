/** Markdown syntax styling from the active theme — created against the
 *  OpenTUI renderer's resource context. */

import { SyntaxStyle } from "@opentui/core";
import type { Theme } from "./theme.js";

export function makeMarkdownStyle(renderer: unknown, theme: Theme): SyntaxStyle | null {
  try {
    const c = theme.colors;
    // OpenTUI ≥0.6.1 wants a NativeResourceOwner (renderer.nativeScene), not
    // the renderer itself; older builds accepted the renderer — keep both.
    const owner = (renderer as { nativeScene?: unknown })?.nativeScene ?? renderer;
    return SyntaxStyle.fromStyles(
      {
        "markup.heading": { fg: c.accent, bold: true },
        "markup.raw": { fg: c.info },
        "markup.link": { fg: c.info, underline: true },
        "markup.list": { fg: c.muted },
        "markup.quote": { fg: c.muted, italic: true },
        keyword: { fg: c.accent },
        string: { fg: c.success },
        comment: { fg: c.muted, italic: true },
        number: { fg: c.warn },
        function: { fg: c.info },
        type: { fg: c.info },
        operator: { fg: c.text },
        punctuation: { fg: c.muted },
        default: { fg: c.text },
      },
      owner as never,
    );
  } catch {
    return null; // plain-text fallback
  }
}
