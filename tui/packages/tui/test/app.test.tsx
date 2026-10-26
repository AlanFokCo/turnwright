/** UI interaction tests on OpenTUI's test renderer (bun runtime required). */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import React from "react";
import { EventEmitter } from "node:events";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { createRoot, type Root } from "@opentui/react";
import type { AgentEvent, ApprovalRequest, ConfirmResult, InitializeResult, TurnStartResult } from "@turnwright/core";
import { App } from "../src/App.js";

const fakeInfo: InitializeResult = {
  protocolVersion: 1,
  version: "test",
  brand: {
    name: "turnwright", tagline: "the coding turnwright — shape your code",
    accent: "#F59E0B", logo: ["TURNWRIGHT"], theme: "turnwright-dark",
  },
  // hermetic cwd: a real checkout would leak the host's git branch into the
  // status line (long branch names wrap and break frame assertions)
  provider: "fake", model: "fake-model", cwd: "/Users/dev/project",
  capabilities: {},
};

class FakeClient extends EventEmitter {
  approval: ((r: ApprovalRequest) => Promise<{ confirmResults: ConfirmResult[] }>) | null = null;
  lastInput: string | null = null;
  turnStarted = 0;

  onApproval(h: any) { this.approval = h; }
  async sessionNew() { return { sessionId: "s-test-0001" }; }
  async sessionResume(sessionId: string) { return { sessionId }; }
  async sessionContinue() { return { sessionId: "s-test-0001" }; }
  async sessionList() { return { sessions: [{ session_id: "s-old-1", summary: "old chat" }] }; }
  async sessionDelete() {}
  async sessionClose() {}
  async turnStart(_sid: string, input: string): Promise<TurnStartResult> {
    this.lastInput = input;
    this.turnStarted++;
    queueMicrotask(() => {
      const evs: AgentEvent[] = [
        { type: "reply_start", session_id: "s-test-0001", reply_id: "r1" },
        { type: "text_block_delta", session_id: "s-test-0001", reply_id: "r1", delta: "pong: " },
        { type: "text_block_delta", session_id: "s-test-0001", reply_id: "r1", delta: input },
        { type: "model_call_end", session_id: "s-test-0001", reply_id: "r1", input_tokens: 3, output_tokens: 2 },
        { type: "reply_end", session_id: "s-test-0001", reply_id: "r1" },
      ];
      for (const e of evs) this.emit("event", e);
    });
    return { started: true };
  }
  async turnCancel() {}
  async modelSet(_sid: string, model: string) { return { model }; }
  async modelList() {
    return { models: [{ name: "fake-model" }, { name: "fake-pro" }], provider: "fake", current: "fake-model" };
  }
  async sessionSetPermission() {}
  async configGet() { return {} as any; }
  dispose() {}
}

let setup: TestRendererSetup;
let root: Root;
let client: FakeClient;

async function pumpUntil(pred: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await setup.renderOnce();
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function pump(n = 4) {
  for (let i = 0; i < n; i++) await setup.renderOnce();
  // let the App's 16ms event-batching window fire, then render its result
  await new Promise((r) => setTimeout(r, 20));
  await setup.renderOnce();
}

async function type(text: string) {
  await setup.mockInput.pressKeys([...text], 1);
  await pump();
}

async function enter() {
  await setup.mockInput.pressKey("RETURN");
  await pump();
}

beforeEach(async () => {
  setup = await createTestRenderer({ width: 80, height: 24 });
  client = new FakeClient();
  root = createRoot(setup.renderer);
  root.render(<App client={client as any} info={fakeInfo} resume={null} />);
  await pump();
});

afterEach(async () => {
  root.unmount();
  await setup.dispose();
});

describe("App", () => {
  test("welcome hero + status line render", async () => {
    const frame = setup.captureCharFrame();
    expect(frame).toContain("TURNWRIGHT");
    expect(frame).toContain("the coding turnwright");
    expect(frame).toContain("fake-model");
    expect(frame).toContain("accept_edits");
  });

  test("typing and submitting a prompt streams the reply", async () => {
    await type("hello turnwright");
    await enter();
    await pump(6);
    await pumpUntil(() => setup.captureCharFrame().includes("pong: hello turnwright"));
    const frame = setup.captureCharFrame();
    expect(frame).toContain("pong: hello turnwright");
    expect(client.lastInput).toBe("hello turnwright");
  });

  test("/help lists commands", async () => {
    await type("/help");
    await enter();
    await pump();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("list commands");
    expect(frame).toContain("/sessions");
  });

  test("/model opens picker and switches", async () => {
    await type("/model");
    await enter();
    await pump();
    let frame = setup.captureCharFrame();
    expect(frame).toContain("fake-pro");
    await setup.mockInput.pressKey("ARROW_DOWN");
    await pump();
    await setup.mockInput.pressKey("RETURN");
    await pump();
    frame = setup.captureCharFrame();
    expect(frame).toContain("fake-pro");
  });

  test("approval dialog answers y", async () => {
    client.turnStart = async (): Promise<TurnStartResult> => {
      queueMicrotask(async () => {
        client.emit("event", { type: "reply_start", session_id: "s-test-0001", reply_id: "r9" });
        const result = await client.approval!({
          session_id: "s-test-0001", reply_id: "r9",
          tool_calls: [{ type: "tool_call", id: "t1", name: "bash", input: '{"command":"rm -rf /tmp/x"}' }],
        });
        expect(result.confirmResults[0]?.confirmed).toBe(true);
        client.emit("event", { type: "reply_end", session_id: "s-test-0001", reply_id: "r9" });
      });
      return { started: true };
    };
    await type("delete it");
    await enter();
    await pump(6);
    let frame = setup.captureCharFrame();
    expect(frame).toContain("Approval required");
    expect(frame).toContain("bash");
    await setup.mockInput.pressKey("y");
    await pump(6);
    frame = setup.captureCharFrame();
    expect(frame).not.toContain("Approval required");
  });

  test("/theme switches palette", async () => {
    await type("/theme turnwright-light");
    await enter();
    await pump();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("turnwright-light");
  });

  test("vim normal mode blocks insertion and edits", async () => {
    await type("/vim");
    await enter();
    await pump();
    await type("abc");
    await setup.mockInput.pressKey("g", { ctrl: true });
    await pump();
    await setup.mockInput.pressKeys(["0"]); // line-home
    await setup.mockInput.pressKeys(["x"]); // delete 'a'
    await setup.mockInput.pressKeys(["z"]); // blocked in normal mode
    await pump();
    expect(setup.captureCharFrame()).toContain("NORM");
    await enter();
    await pump(6);
    expect(client.lastInput).toBe("bc");
  });

  test("ctrl+j inserts a newline, enter submits both lines", async () => {
    await type("line1");
    await setup.mockInput.pressKey("j", { ctrl: true });
    await type("line2");
    await enter();
    await pump(6);
    expect(client.lastInput).toBe("line1\nline2");
  });

  test("up arrow recalls prompt history", async () => {
    await type("first");
    await enter();
    await pump(6);
    await type("second");
    await enter();
    await pump(6);
    await setup.mockInput.pressKey("ARROW_UP");
    await pump();
    let frame = setup.captureCharFrame();
    expect(frame).toContain("second");
    await setup.mockInput.pressKey("ARROW_UP");
    await pump();
    frame = setup.captureCharFrame();
    expect(frame).toContain("first");
    await enter();
    await pump(6);
    expect(client.lastInput).toBe("first");
  });
});
