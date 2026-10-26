import { describe, expect, it } from "vitest";
import { initialChatState, pushUser, reduce } from "../src/store.js";
import type { AgentEvent } from "@turnwright/core";

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

  it("renders a user shell command (! prefix) outside the model context", () => {
    let st = initialChatState;
    const evs: AgentEvent[] = [
      { type: "custom", session_id: "s", name: "user_shell_start", value: { command_id: "c1", command: "echo hi" } },
      { type: "custom", session_id: "s", name: "user_shell_output", value: { command_id: "c1", data: "hi\n" } },
      { type: "custom", session_id: "s", name: "user_shell_end", value: { command_id: "c1", exit_code: 0, duration_ms: 12 } },
    ];
    for (const e of evs) st = reduce(st, e);
    const shell = st.entries[0];
    if (shell?.kind !== "shell") throw new Error("no shell entry");
    expect(shell.command).toBe("echo hi");
    expect(shell.output).toBe("hi\n");
    expect(shell.done).toBe(true);
    expect(shell.exitCode).toBe(0);
  });

  it("updates the plan panel from plan_updated", () => {
    let st = initialChatState;
    st = reduce(st, { type: "custom", session_id: "s", name: "plan_updated", value: {
      explanation: "merge flow",
      plan: [{ step: "pull", status: "in_progress" }, { step: "resolve", status: "pending" }],
    } });
    expect(st.plan?.explanation).toBe("merge flow");
    expect(st.plan?.steps).toHaveLength(2);
    expect(st.plan?.steps[1]?.status).toBe("pending");
  });

  it("applies authoritative turn_stats token totals", () => {
    let st = pushUser(initialChatState, "hi");
    const base: AgentEvent[] = [
      { type: "reply_start", session_id: "s", reply_id: "r1" },
      { type: "model_call_end", session_id: "s", reply_id: "r1", input_tokens: 10, output_tokens: 5 },
    ];
    for (const e of base) st = reduce(st, e);
    st = reduce(st, { type: "custom", session_id: "s", reply_id: "r1", name: "turn_stats", value: {
      input_tokens: 33, output_tokens: 7, model_calls: 2,
    } });
    const reply = st.entries[1];
    if (reply?.kind !== "reply") throw new Error("no reply");
    expect(reply.inTok).toBe(33); // replaced, not accumulated
    expect(reply.outTok).toBe(7);
  });
});
