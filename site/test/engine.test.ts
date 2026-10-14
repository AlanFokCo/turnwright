import { describe, expect, it } from "vitest";
import { applyEvent, eventsUpTo, initialRenderState, stateAt } from "@/replay/engine";

const toolCall = { type: "tool_use", id: "tc1", name: "bash", input: '{"cmd":"go test ./..."}' };

describe("replay engine", () => {
  it("starts idle with empty entries", () => {
    const st = initialRenderState();
    expect(st).toMatchObject({ entries: [], busy: false, inTok: 0, outTok: 0, theme: "dark" });
  });
  it("reply_start marks busy; reply_end clears it", () => {
    let st = applyEvent(initialRenderState(), { type: "reply_start", reply_id: "r1" });
    expect(st.busy).toBe(true);
    st = applyEvent(st, { type: "reply_end", finished_reason: "stop" });
    expect(st.busy).toBe(false);
  });
  it("accumulates text deltas into one entry", () => {
    let st = applyEvent(initialRenderState(), { type: "text_block_delta", delta: "Hel", block_id: "b1" });
    st = applyEvent(st, { type: "text_block_delta", delta: "lo", block_id: "b1" });
    expect(st.entries.filter((e) => e.kind === "text")).toHaveLength(1);
    expect((st.entries.at(-1) as { text: string }).text).toBe("Hello");
  });
  it("runs the tool lifecycle start → end → result", () => {
    let st = applyEvent(initialRenderState(), {
      type: "tool_call_start", tool_call_id: "tc1", tool_call_name: "bash", tool_call_input: "{}",
    });
    expect(st.entries.at(-1)).toMatchObject({ kind: "tool", state: "running", name: "bash" });
    st = applyEvent(st, { type: "tool_call_end", tool_call_id: "tc1", state: "success" });
    st = applyEvent(st, { type: "tool_result_end", tool_call_id: "tc1", message: "ok" });
    expect(st.entries.at(-1)).toMatchObject({ kind: "tool", state: "done", result: "ok" });
  });
  it("require_user_confirm opens an approval entry; tool_policy_denied marks denied", () => {
    let st = applyEvent(initialRenderState(), { type: "require_user_confirm", tool_calls: [toolCall] });
    const approval = st.entries.at(-1) as { kind: string; resolved?: string };
    expect(approval.kind).toBe("approval");
    expect(approval.resolved).toBeUndefined(); // unresolved until the scripted answer
    st = applyEvent(st, { type: "tool_policy_denied", tool_call_id: "tc1", tool_call_name: "bash" });
    expect(st.entries.some((e) => e.kind === "tool" && e.state === "denied")).toBe(true);
  });
  it("counts tokens from model_call_end and surfaces reply_end errors", () => {
    let st = applyEvent(initialRenderState(), { type: "model_call_end", input_tokens: 1200, output_tokens: 340 });
    expect(st).toMatchObject({ inTok: 1200, outTok: 340 });
    st = applyEvent(st, { type: "reply_end", error: { message: "boom" } });
    expect(st.entries.at(-1)).toMatchObject({ kind: "notice", tone: "error", text: "boom" });
  });
  it("exceed_max_iters becomes a warn notice", () => {
    const st = applyEvent(initialRenderState(), { type: "exceed_max_iters" });
    expect(st.entries.at(-1)).toMatchObject({ kind: "notice", tone: "warn" });
  });
  it("eventsUpTo is inclusive of t and stateAt folds the prefix", () => {
    const script = [
      { t: 0, ev: { type: "reply_start" } },
      { t: 100, ev: { type: "text_block_delta", delta: "a" } },
      { t: 200, ev: { type: "text_block_delta", delta: "b" } },
    ];
    expect(eventsUpTo(script, 100)).toHaveLength(2);
    expect((stateAt(script, 200).entries.at(-1) as { text: string }).text).toBe("ab");
    expect(stateAt(script, 0).entries).toHaveLength(0);
  });
});
