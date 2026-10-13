/** Quality rubric measurements — targets from the v2 M4 quality sprint. */

import { describe, expect, test } from "bun:test";
import React from "react";
import { EventEmitter } from "node:events";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { createRoot, type Root } from "@opentui/react";
import type { AgentEvent, InitializeResult } from "@turnwright/core";
import { App } from "../src/App.js";
import { initialChatState, pushNotice, reduce } from "../src/store.js";
import { MessageView } from "../src/components.js";
import { builtinTheme } from "../src/theme.js";

const fakeInfo: InitializeResult = {
  protocolVersion: 1, version: "test",
  brand: { name: "turnwright", tagline: "shape your code", accent: "#F59E0B", logo: ["TURNWRIGHT"], theme: "turnwright-dark" },
  provider: "fake", model: "fake-model", cwd: process.cwd(), capabilities: {},
};

class FakeClient extends EventEmitter {
  onApproval() {}
  async sessionNew() { return { sessionId: "s-rubric" }; }
  async sessionResume(s: string) { return { sessionId: s }; }
  async sessionContinue() { return { sessionId: "s-rubric" }; }
  async sessionList() { return { sessions: [] }; }
  async sessionDelete() {}
  async sessionClose() {}
  async turnStart() {}
  async turnCancel() {}
  async modelSet() { return { model: "m" }; }
  async modelList() { return { models: [], provider: "fake", current: "fake" }; }
  async sessionSetPermission() {}
  async configGet() { return {} as any; }
  dispose() {}
}

async function boot(width = 80, height = 24): Promise<{ setup: TestRendererSetup; root: Root; ms: number }> {
  const t0 = performance.now();
  const setup = await createTestRenderer({ width, height });
  const root = createRoot(setup.renderer);
  root.render(<App client={new FakeClient() as any} info={fakeInfo} resume={null} />);
  await setup.renderOnce();
  const ms = performance.now() - t0;
  for (let i = 0; i < 3; i++) await setup.renderOnce();
  return { setup, root, ms };
}

describe("rubric", () => {
  test("1. first paint to usable input fast", async () => {
    const { setup, root, ms } = await boot();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("ask turnwright");
    console.log(`METRIC first_paint_ms=${ms.toFixed(1)}`);
    expect(ms).toBeLessThan(500); // test-renderer proxy; real target <100ms measured on device
    root.unmount();
    await setup.dispose();
  });

  test("2. input echo within one frame", async () => {
    const { setup, root } = await boot();
    await setup.mockInput.pressKeys(["h"]);
    const t0 = performance.now();
    await setup.renderOnce();
    const ms = performance.now() - t0;
    expect(setup.captureCharFrame()).toContain("h");
    console.log(`METRIC echo_ms=${ms.toFixed(1)}`);
    expect(ms).toBeLessThan(32);
    root.unmount();
    await setup.dispose();
  });

  test("3a. 80x24 narrow terminal: all regions intact", async () => {
    const { setup, root } = await boot(80, 24);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("TURNWRIGHT");
    expect(frame).toContain("ready");
    expect(frame).toContain("ask turnwright");
    // every row exactly 80 cells — no overflow, no collapse
    for (const line of frame.split("\n").slice(0, 24)) {
      expect([0, 80]).toContain(line.length);
    }
    root.unmount();
    await setup.dispose();
  });

  test("3b. 60x16 tiny terminal stays usable", async () => {
    const { setup, root } = await boot(60, 16);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("ask turnwright");
    expect(frame).toContain("ready");
    root.unmount();
    await setup.dispose();
  });

  test("9. CJK + latin mixed reply renders and aligns", async () => {
    const setup = await createTestRenderer({ width: 60, height: 10 });
    const root = createRoot(setup.renderer);
    const reply = {
      kind: "reply" as const, replyId: "r", text: "好的，已修复 `main.go` 的空指针。Done — 测试全绿。",
      thinking: "", thinkingCollapsed: true, tools: [], done: true,
      inTok: 0, outTok: 0, startedAt: 0, endedAt: 1,
      segments: [{ kind: "text" as const, text: "好的，已修复 `main.go` 的空指针。Done — 测试全绿。" }],
    };
    root.render(<box flexDirection="column"><MessageView entry={reply} theme={builtinTheme("turnwright-dark")} /></box>);
    for (let i = 0; i < 4; i++) await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("好的，已修复");
    expect(frame).toContain("测试全绿");
    root.unmount();
    await setup.dispose();
  });

  test("3c. resize 80x24 → 55x17: no artifacts, regions intact", async () => {
    const { setup, root } = await boot(80, 24);
    setup.resize(55, 17);
    for (let i = 0; i < 4; i++) await setup.renderOnce();
    const frame = setup.captureCharFrame();
    const lines = frame.split("\n");
    expect(lines.length).toBeLessThanOrEqual(18); // 17 rows + trailing newline
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(55);
    expect(frame).toContain("ready");
    expect(frame).toContain("ask turnwright");
    root.unmount();
    await setup.dispose();
  });

  test("5. mouse wheel scrolls the transcript", async () => {
    const { setup, root } = await boot(80, 24);
    const c = new FakeClient();
    root.unmount();
    const r2 = createRoot(setup.renderer);
    r2.render(<App client={c as any} info={fakeInfo} resume={null} />);
    for (let i = 0; i < 4; i++) await setup.renderOnce();
    for (let i = 0; i < 60; i++) {
      c.emit("event", { type: "reply_start", session_id: "s", reply_id: `m${i}` });
      c.emit("event", { type: "text_block_delta", session_id: "s", reply_id: `m${i}`, delta: `scroll-marker-${i}` });
      c.emit("event", { type: "reply_end", session_id: "s", reply_id: `m${i}` });
    }
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < 4; i++) await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("scroll-marker-59");
    expect(setup.captureCharFrame()).not.toContain("scroll-marker-0  ");
    await setup.mockMouse.scroll(40, 5, "up");
    await setup.mockMouse.scroll(40, 5, "up");
    await setup.mockMouse.scroll(40, 5, "up");
    for (let i = 0; i < 4; i++) await setup.renderOnce();
    const frame = setup.captureCharFrame();
    // after scrolling up, the newest marker must leave the viewport
    expect(frame).not.toContain("scroll-marker-59");
    r2.unmount();
    await setup.dispose();
  });

  test("4. engine exit surfaces actionable error", async () => {
    const { setup, root } = await boot();
    const client = new FakeClient();
    // mounted App already holds its own client; simulate via a fresh mount:
    root.unmount();
    const c = new FakeClient();
    const r2 = createRoot(setup.renderer);
    r2.render(<App client={c as any} info={fakeInfo} resume={null} />);
    for (let i = 0; i < 4; i++) await setup.renderOnce();
    c.emit("exit", 1);
    for (let i = 0; i < 4; i++) await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("engine exited");
    expect(frame).toContain("restart");
    r2.unmount();
    await setup.dispose();
  });

  test("2b. 500 streamed events stay responsive", async () => {
    const { setup, root } = await boot();
    const c = new FakeClient();
    root.unmount();
    const r2 = createRoot(setup.renderer);
    r2.render(<App client={c as any} info={fakeInfo} resume={null} />);
    for (let i = 0; i < 4; i++) await setup.renderOnce();
    let st = initialChatState;
    st = reduce(st, { type: "reply_start", session_id: "s", reply_id: "r" } as AgentEvent);
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) {
      st = reduce(st, { type: "text_block_delta", session_id: "s", reply_id: "r", delta: "chunk " } as AgentEvent);
    }
    const reduceMs = performance.now() - t0;
    console.log(`METRIC reduce_500_deltas_ms=${reduceMs.toFixed(1)}`);
    expect(reduceMs).toBeLessThan(500);
    // long history for real: drive 200 turn cycles through the mounted App
    for (let i = 0; i < 200; i++) {
      c.emit("event", { type: "reply_start", session_id: "s", reply_id: `rr${i}` });
      c.emit("event", { type: "text_block_delta", session_id: "s", reply_id: `rr${i}`, delta: `turn ${i} reply body with some text` });
      c.emit("event", { type: "reply_end", session_id: "s", reply_id: `rr${i}` });
    }
    const t1 = performance.now();
    for (let i = 0; i < 4; i++) await setup.renderOnce();
    const pumpMs = performance.now() - t1;
    console.log(`METRIC pump_long_history_ms=${pumpMs.toFixed(1)}`);
    expect(pumpMs).toBeLessThan(2000);
    r2.unmount();
    await setup.dispose();
  });

  test("10. renderer memory stays modest", async () => {
    const { setup, root } = await boot();
    const rss = process.memoryUsage().rss / 1024 / 1024;
    console.log(`METRIC rss_mb=${rss.toFixed(0)}`);
    expect(rss).toBeLessThan(400); // bun runtime + test renderer; target <150MB measured for the shipped binary
    root.unmount();
    await setup.dispose();
  });
});
