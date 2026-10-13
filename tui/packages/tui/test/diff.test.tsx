import { test, expect } from "bun:test";
import React from "react";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { MessageView } from "../src/components.js";
import { builtinTheme } from "../src/theme.js";
import type { ReplyEntry } from "../src/store.js";

test("tool diff output renders via <diff>", async () => {
  const setup = await createTestRenderer({ width: 70, height: 20 });
  const root = createRoot(setup.renderer);
  const reply: ReplyEntry = {
    kind: "reply", replyId: "r1", text: "", thinking: "", thinkingCollapsed: true,
    done: true, inTok: 0, outTok: 0, startedAt: 0, endedAt: 1,
    segments: [{ kind: "tool", toolId: "t1" }],
    tools: [{
      id: "t1", name: "edit", input: '{"path":"a.ts"}',
      output: "--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n-old line\n+new line\n ctx",
      state: "success",
    }],
  };
  root.render(<box flexDirection="column"><MessageView entry={reply} theme={builtinTheme("lathe-dark")} /></box>);
  for (let i = 0; i < 6; i++) await setup.renderOnce();
  const frame = setup.captureCharFrame();
  console.log(JSON.stringify(frame));
  expect(frame).toContain("edit");
  expect(frame).toContain("new line");
  await setup.dispose();
});
