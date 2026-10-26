import { expect, test } from "bun:test";
import React from "react";
import { EventEmitter } from "node:events";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { App } from "../src/App.js";

const info: any = {
  protocolVersion: 1, version: "2.0.0-dev",
  brand: { name: "turnwright", tagline: "the coding turnwright — shape your code", accent: "#F59E0B",
    logo: ["┬   ┌─┐ ┌┬┐ ┬ ┬ ┌─┐", "│   ├─┤  │  ├─┤ ├┤ ", "┴─┘ ┴ ┴  ┴  ┴ ┴ └─┘"], theme: "turnwright-dark" },
  provider: "dashscope", model: "qwen3-max", cwd: "/Users/dev/project", capabilities: {},
};
class C extends EventEmitter {
  onApproval() {}
  async sessionNew() { return { sessionId: "a1b2c3d4-e5f6" }; }
  async sessionResume(s: string) { return { sessionId: s }; }
  async sessionContinue() { return { sessionId: "a1b2c3d4-e5f6" }; }
  async sessionList() { return { sessions: [] }; }
  async sessionDelete() {} async sessionClose() {}
  async turnStart() { return { started: true }; } async turnCancel() { return { cancelled: false }; }
  async modelSet() { return { model: "m" }; }
  async modelList() { return { models: [], provider: "x", current: "x" }; }
  async sessionSetPermission() {} async configGet() { return {} as any; }
  dispose() {}
}

test("walkthrough", async () => {
  const setup = await createTestRenderer({ width: 84, height: 30 });
  const root = createRoot(setup.renderer);
  const c = new C();
  root.render(<App client={c as any} info={info} resume={null} />);
  for (let i = 0; i < 4; i++) await setup.renderOnce();
  await setup.mockInput.pressKeys([..."把 README 的开头改得更克制一点"], 1);
  await setup.mockInput.pressKey("RETURN");
  c.emit("event", { type: "reply_start", session_id: "a1b2c3d4", reply_id: "r1" });
  c.emit("event", { type: "text_block_delta", session_id: "a1b2c3d4", reply_id: "r1", delta: "我先看一下现在的开头，再给出更克制的版本。\n\n" });
  c.emit("event", { type: "tool_call_start", session_id: "a1b2c3d4", reply_id: "r1", tool_call_id: "t1", tool_call_name: "read", tool_call_input: '{"path":"README.md"}' });
  c.emit("event", { type: "tool_call_end", session_id: "a1b2c3d4", reply_id: "r1", tool_call_id: "t1" });
  c.emit("event", { type: "tool_result_end", session_id: "a1b2c3d4", reply_id: "r1", tool_call_id: "t1", state: "success" });
  c.emit("event", { type: "tool_call_start", session_id: "a1b2c3d4", reply_id: "r1", tool_call_id: "t2", tool_call_name: "edit", tool_call_input: '{"path":"README.md"}' });
  c.emit("event", { type: "tool_call_end", session_id: "a1b2c3d4", reply_id: "r1", tool_call_id: "t2" });
  c.emit("event", { type: "tool_result_text_delta", session_id: "a1b2c3d4", reply_id: "r1", tool_call_id: "t2", delta: "--- a/README.md\n+++ b/README.md\n@@ -1,2 +1,2 @@\n-# turnwright —— 革命性的下一代终极 AI 编程Agent！！！\n+# turnwright\n 一个终端里的 coding agent。" });
  c.emit("event", { type: "tool_result_end", session_id: "a1b2c3d4", reply_id: "r1", tool_call_id: "t2", state: "success" });
  c.emit("event", { type: "text_block_delta", session_id: "a1b2c3d4", reply_id: "r1", delta: "改好了：删掉夸张修辞，首行只留名字，描述压成一句。" });
  c.emit("event", { type: "model_call_end", session_id: "a1b2c3d4", reply_id: "r1", input_tokens: 3210, output_tokens: 212 });
  c.emit("event", { type: "reply_end", session_id: "a1b2c3d4", reply_id: "r1" });
  // markdown replies paint asynchronously: wait for the closing text
  const deadline = Date.now() + 5000;
  let frame = "";
  while (Date.now() < deadline) {
    await setup.renderOnce();
    await new Promise((r) => setTimeout(r, 25));
    frame = setup.captureCharFrame();
    if (frame.includes("改好了")) break;
  }
  require("node:fs").writeFileSync("/tmp/walkthrough.txt", frame);
  // interleaving: closing text renders after both tool cards
  expect(frame.indexOf("改好了")).toBeGreaterThan(frame.indexOf("✓ edit"));
  expect(frame.indexOf("✓ edit")).toBeGreaterThan(frame.indexOf("✓ read"));
  expect(frame.indexOf("✓ read")).toBeGreaterThan(frame.indexOf("我先看一下"));
  // input box borders align (top/bottom edges identical width)
  const edges = frame.split("\n").filter((l) => l.trimStart().startsWith("┌") || l.trimStart().startsWith("└"));
  expect(edges.length).toBe(2);
  expect(edges[0]!.length).toBe(edges[1]!.length);
  console.log(frame);
  await setup.dispose();
});
