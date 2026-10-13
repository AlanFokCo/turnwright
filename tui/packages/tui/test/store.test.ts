import { describe, expect, it } from "vitest";
import { initialChatState, pushUser, reduce } from "../src/store.js";
import type { AgentEvent } from "@lathe/core";

describe("chat store", () => {
  it("accumulates a streamed reply", () => {
    let st = pushUser(initialChatState, "hi");
    const evs: AgentEvent[] = [
      { type: "reply_start", session_id: "s", reply_id: "r1" },
      { type: "text_block_delta", session_id: "s", reply_id: "r1", delta: "Hello" },
      { type: "text_block_delta", session_id: "s", reply_id: "r1", delta: " world" },
      { type: "model_call_end", session_id: "s", reply_id: "r1", input_tokens: 10, output_tokens: 5 },
      { type: "reply_end", session_id: "s", reply_id: "r1" },
    ];
    for (const e of evs) st = reduce(st, e);
    const reply = st.entries[1];
    expect(reply?.kind).toBe("reply");
    if (reply?.kind === "reply") {
      expect(reply.text).toBe("Hello world");
      expect(reply.done).toBe(true);
      expect(reply.inTok).toBe(10);
    }
    expect(st.busy).toBe(false);
  });

  it("tracks tool calls end to end", () => {
    let st = pushUser(initialChatState, "run");
    const evs: AgentEvent[] = [
      { type: "reply_start", session_id: "s", reply_id: "r1" },
      { type: "tool_call_start", session_id: "s", reply_id: "r1", tool_call_id: "t1", tool_call_name: "bash" },
      { type: "tool_call_delta", session_id: "s", reply_id: "r1", tool_call_id: "t1", delta: '{"command":"ls"' },
      { type: "tool_call_delta", session_id: "s", reply_id: "r1", tool_call_id: "t1", delta: "}" },
      { type: "tool_call_end", session_id: "s", reply_id: "r1", tool_call_id: "t1" },
      { type: "tool_result_text_delta", session_id: "s", reply_id: "r1", tool_call_id: "t1", delta: "file.go" },
      { type: "tool_result_end", session_id: "s", reply_id: "r1", tool_call_id: "t1", state: "success" },
      { type: "reply_end", session_id: "s", reply_id: "r1" },
    ];
    for (const e of evs) st = reduce(st, e);
    const reply = st.entries[1];
    if (reply?.kind !== "reply") throw new Error("no reply");
    expect(reply.tools[0]?.name).toBe("bash");
    expect(reply.tools[0]?.input).toBe('{"command":"ls"}');
    expect(reply.tools[0]?.output).toBe("file.go");
    expect(reply.tools[0]?.state).toBe("success");
  });
});
