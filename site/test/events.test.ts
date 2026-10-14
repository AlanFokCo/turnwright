import { describe, expect, it } from "vitest";
import { REPLAY_EVENT_TYPES, validateScript } from "@/replay/events";

describe("replay event schema", () => {
  it("pins the vocabulary to the documented 14 event types", () => {
    expect(REPLAY_EVENT_TYPES).toEqual([
      "reply_start", "text_block_start", "text_block_delta", "thinking_block_delta",
      "tool_call_start", "tool_call_delta", "tool_call_end",
      "tool_result_text_delta", "tool_result_end", "tool_policy_denied",
      "require_user_confirm", "model_call_end", "reply_end", "exceed_max_iters",
    ]);
  });
  it("accepts a minimal timed script", () => {
    const s = validateScript([
      { t: 0, ev: { type: "reply_start", reply_id: "r1" } },
      { t: 50, ev: { type: "text_block_delta", delta: "hi" } },
    ]);
    expect(s).toHaveLength(2);
  });
  it("rejects negative time and malformed tool_calls", () => {
    expect(() => validateScript([{ t: -1, ev: { type: "reply_start" } }])).toThrow();
    expect(() =>
      validateScript([{ t: 0, ev: { type: "require_user_confirm", tool_calls: [{ id: "x" }] } }]),
    ).toThrow();
  });
});
