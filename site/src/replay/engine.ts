import type { AgentEventLike, TimedEvent, ToolCallLike } from "./events";

/** Pure playback state machine: folds an AgentEvent-shaped stream into the
 *  entries the player renders. No mutation, no time knowledge — the player
 *  supplies `t` via eventsUpTo/stateAt. */

export type Entry =
  | { kind: "user"; text: string }
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; id: string; name: string; input: string; state: "running" | "done" | "denied"; result?: string }
  | { kind: "approval"; toolCalls: ToolCallLike[]; resolved?: "once" | "denied" | "always" }
  | { kind: "notice"; text: string; tone: "info" | "warn" | "error" };

export interface RenderState {
  entries: Entry[];
  busy: boolean;
  inTok: number;
  outTok: number;
  theme: "dark" | "light";
}

export function initialRenderState(): RenderState {
  return { entries: [], busy: false, inTok: 0, outTok: 0, theme: "dark" };
}

function lastTool(st: RenderState, id?: string): Extract<Entry, { kind: "tool" }> | undefined {
  if (!id) return undefined;
  for (let i = st.entries.length - 1; i >= 0; i--) {
    const e = st.entries[i]!;
    if (e.kind === "tool" && e.id === id) return e;
  }
  return undefined;
}

export function applyEvent(st: RenderState, ev: AgentEventLike): RenderState {
  const entries = [...st.entries];
  let { busy, inTok, outTok, theme } = st;

  const push = (e: Entry) => entries.push(e);
  const last = entries[entries.length - 1];

  switch (ev.type) {
    case "reply_start":
      busy = true;
      break;
    case "reply_end":
      busy = false;
      if (ev.error) push({ kind: "notice", text: ev.error.message, tone: "error" });
      break;
    case "text_block_delta": {
      const d = ev.delta ?? "";
      if (last?.kind === "text") entries[entries.length - 1] = { kind: "text", text: last.text + d };
      else push({ kind: "text", text: d });
      break;
    }
    case "thinking_block_delta": {
      const d = ev.delta ?? "";
      if (last?.kind === "thinking") entries[entries.length - 1] = { kind: "thinking", text: last.text + d };
      else push({ kind: "thinking", text: d });
      break;
    }
    case "tool_call_start":
      push({
        kind: "tool",
        id: ev.tool_call_id ?? "",
        name: ev.tool_call_name ?? "",
        input: ev.tool_call_input ?? "",
        state: "running",
      });
      break;
    case "tool_call_delta": {
      const tool = lastTool(st, ev.tool_call_id);
      if (tool) {
        const idx = entries.indexOf(tool);
        entries[idx] = { ...tool, input: tool.input + (ev.delta ?? "") };
      }
      break;
    }
    case "tool_call_end": {
      const tool = lastTool(st, ev.tool_call_id);
      if (tool && tool.state === "running") {
        const idx = entries.indexOf(tool);
        entries[idx] = { ...tool, state: ev.state === "denied" ? "denied" : "done" };
      }
      break;
    }
    case "tool_result_text_delta": {
      const tool = lastTool(st, ev.tool_call_id);
      if (tool) {
        const idx = entries.indexOf(tool);
        entries[idx] = { ...tool, result: (tool.result ?? "") + (ev.delta ?? "") };
      }
      break;
    }
    case "tool_result_end": {
      const tool = lastTool(st, ev.tool_call_id);
      if (tool) {
        const idx = entries.indexOf(tool);
        entries[idx] = { ...tool, result: ev.message ?? tool.result, state: tool.state === "denied" ? "denied" : "done" };
      }
      break;
    }
    case "tool_policy_denied": {
      const tool = lastTool(st, ev.tool_call_id);
      if (tool) {
        const idx = entries.indexOf(tool);
        entries[idx] = { ...tool, state: "denied" };
      } else {
        // denial can arrive for a call that never started (proposed, blocked by rule)
        push({
          kind: "tool",
          id: ev.tool_call_id ?? "",
          name: ev.tool_call_name ?? "",
          input: "",
          state: "denied",
        });
      }
      push({ kind: "notice", text: `permission denied: ${ev.tool_call_name ?? "tool"}`, tone: "warn" });
      break;
    }
    case "require_user_confirm":
      push({ kind: "approval", toolCalls: ev.tool_calls ?? [] });
      break;
    case "model_call_end":
      inTok += ev.input_tokens ?? 0;
      outTok += ev.output_tokens ?? 0;
      break;
    case "exceed_max_iters":
      push({ kind: "notice", text: "max iterations exceeded", tone: "warn" });
      break;
    default:
      break; // unknown upstream event: ignore (forward compatible)
  }
  return { entries, busy, inTok, outTok, theme };
}

export function eventsUpTo(script: TimedEvent[], t: number): TimedEvent[] {
  return script.filter((e) => e.t <= t);
}

export function stateAt(script: TimedEvent[], t: number): RenderState {
  return eventsUpTo(script, t).reduce((st, e) => applyEvent(st, e.ev), initialRenderState());
}
