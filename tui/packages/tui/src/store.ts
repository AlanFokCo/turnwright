/** Chat state: an event-sourced reducer fed by the agentscope event stream. */

import type { AgentEvent, ToolCallBlock } from "@turnwright/core";

export interface ToolEntry {
  id: string;
  name: string;
  input: string;
  output: string;
  state: "streaming" | "running" | "success" | "error" | "denied";
}

/** Render order within a reply: text paragraphs and tool calls interleave. */
export type Segment =
  | { kind: "text"; text: string }
  | { kind: "tool"; toolId: string };

export interface ReplyEntry {
  kind: "reply";
  replyId: string;
  text: string;
  thinking: string;
  thinkingCollapsed: boolean;
  tools: ToolEntry[];
  segments: Segment[];
  done: boolean;
  inTok: number;
  outTok: number;
  startedAt: number;
  endedAt?: number | undefined;
  error?: string | undefined;
}

export interface UserEntry {
  kind: "user";
  text: string;
}

export interface NoticeEntry {
  kind: "notice";
  text: string;
  level: "info" | "warn" | "error";
}

/** One user-initiated `!` shell command (codex `!` parity): runs outside the
 *  model loop; output never enters model context. */
export interface ShellEntry {
  kind: "shell";
  commandId: string;
  command: string;
  output: string;
  exitCode?: number;
  done: boolean;
}

export type Entry = UserEntry | ReplyEntry | NoticeEntry | ShellEntry;

/** A model-maintained step plan (update_plan tool, codex parity). */
export interface PlanState {
  explanation?: string;
  steps: { step: string; status: string }[];
}

export interface ChatState {
  entries: Entry[];
  activeReplyId: string | null;
  busy: boolean;
  plan: PlanState | null;
}

export const initialChatState: ChatState = { entries: [], activeReplyId: null, busy: false, plan: null };

function lastReply(st: ChatState): ReplyEntry | undefined {
  const e = st.entries[st.entries.length - 1];
  return e && e.kind === "reply" ? e : undefined;
}

export function reduce(st: ChatState, ev: AgentEvent): ChatState {
  switch (ev.type) {
    case "reply_start": {
      const reply: ReplyEntry = {
        kind: "reply", replyId: ev.reply_id ?? "", text: "", thinking: "",
        thinkingCollapsed: true, tools: [], segments: [], done: false, inTok: 0, outTok: 0,
        startedAt: Date.now(),
      };
      return { ...st, entries: [...st.entries, reply], activeReplyId: ev.reply_id ?? null, busy: true };
    }
    case "text_block_start": {
      const r = lastReply(st);
      if (!r) return st;
      const next = { ...r, segments: [...r.segments, { kind: "text" as const, text: "" }] };
      return { ...st, entries: [...st.entries.slice(0, -1), next] };
    }
    case "text_block_delta":
    case "thinking_block_delta": {
      const r = lastReply(st);
      if (!r) return st;
      const key = ev.type === "text_block_delta" ? "text" : "thinking";
      const next = { ...r, [key]: r[key] + (ev.delta ?? "") } as ReplyEntry;
      if (ev.type === "text_block_delta") {
        const segs = [...next.segments];
        const last = segs[segs.length - 1];
        if (last?.kind === "text") segs[segs.length - 1] = { kind: "text", text: last.text + (ev.delta ?? "") };
        else segs.push({ kind: "text", text: ev.delta ?? "" });
        next.segments = segs;
      }
      return { ...st, entries: [...st.entries.slice(0, -1), next] };
    }
    case "tool_call_start": {
      const r = lastReply(st);
      if (!r) return st;
      const t: ToolEntry = {
        id: ev.tool_call_id ?? "", name: ev.tool_call_name ?? "tool",
        input: ev.tool_call_input ?? "", output: "", state: "streaming",
      };
      return {
        ...st,
        entries: [...st.entries.slice(0, -1), {
          ...r, tools: [...r.tools, t],
          segments: [...r.segments, { kind: "tool" as const, toolId: t.id }],
        }],
      };
    }
    case "tool_call_delta": {
      const r = lastReply(st);
      if (!r) return st;
      const tools = r.tools.map((t) =>
        t.id === ev.tool_call_id ? { ...t, input: t.input + (ev.delta ?? "") } : t);
      return { ...st, entries: [...st.entries.slice(0, -1), { ...r, tools }] };
    }
    case "tool_call_end": {
      const r = lastReply(st);
      if (!r) return st;
      const tools = r.tools.map((t) =>
        t.id === ev.tool_call_id ? { ...t, state: "running" as const } : t);
      return { ...st, entries: [...st.entries.slice(0, -1), { ...r, tools }] };
    }
    case "tool_result_text_delta": {
      const r = lastReply(st);
      if (!r) return st;
      const tools = r.tools.map((t) =>
        t.id === ev.tool_call_id ? { ...t, output: t.output + (ev.delta ?? "") } : t);
      return { ...st, entries: [...st.entries.slice(0, -1), { ...r, tools }] };
    }
    case "tool_result_end": {
      const r = lastReply(st);
      if (!r) return st;
      const state: ToolEntry["state"] = ev.state === "error" ? "error" : "success";
      const tools = r.tools.map((t) => (t.id === ev.tool_call_id ? { ...t, state } : t));
      return { ...st, entries: [...st.entries.slice(0, -1), { ...r, tools }] };
    }
    case "tool_policy_denied": {
      const r = lastReply(st);
      if (!r) return st;
      const tools = r.tools.map((t) =>
        t.id === ev.tool_call_id ? { ...t, state: "denied" as const } : t);
      return { ...st, entries: [...st.entries.slice(0, -1), { ...r, tools }] };
    }
    case "model_call_end": {
      const r = lastReply(st);
      if (!r) return st;
      const next = {
        ...r,
        inTok: r.inTok + (ev.input_tokens ?? 0),
        outTok: r.outTok + (ev.output_tokens ?? 0),
      };
      return { ...st, entries: [...st.entries.slice(0, -1), next] };
    }
    case "custom": {
      // Structured custom events: user shell commands, plan updates and
      // per-reply stats render as real UI; the rest become notices.
      switch (ev.name) {
        case "user_shell_start": {
          const v = ev.value ?? {};
          const entry: ShellEntry = {
            kind: "shell",
            commandId: String(v.command_id ?? ev.reply_id ?? ""),
            command: String(v.command ?? ""),
            output: "",
            done: false,
          };
          return { ...st, entries: [...st.entries, entry] };
        }
        case "user_shell_output": {
          const v = ev.value ?? {};
          return { ...st, entries: st.entries.map((e) =>
            e.kind === "shell" && e.commandId === String(v.command_id ?? ev.reply_id ?? "")
              ? { ...e, output: e.output + String(v.data ?? "") }
              : e) };
        }
        case "user_shell_end": {
          const v = ev.value ?? {};
          return { ...st, entries: st.entries.map((e): Entry => {
            if (e.kind !== "shell" || e.commandId !== String(v.command_id ?? ev.reply_id ?? "")) return e;
            const next: ShellEntry = { ...e, done: true };
            if (typeof v.exit_code === "number") next.exitCode = v.exit_code;
            return next;
          }) };
        }
        case "plan_updated": {
          const v = ev.value ?? {};
          const plan: PlanState = {
            steps: Array.isArray(v.plan)
              ? (v.plan as { step: string; status: string }[])
              : [],
          };
          if (typeof v.explanation === "string") {
            plan.explanation = v.explanation;
          }
          return { ...st, plan };
        }
        case "turn_stats": {
          const v = ev.value ?? {};
          const r = lastReply(st);
          if (!r) return st;
          // Authoritative per-reply totals (includes compression usage that
          // delta events miss) — replace, don't accumulate.
          const next: ReplyEntry = {
            ...r,
            inTok: typeof v.input_tokens === "number" ? v.input_tokens : r.inTok,
            outTok: typeof v.output_tokens === "number" ? v.output_tokens : r.outTok,
          };
          return { ...st, entries: [...st.entries.slice(0, -1), next] };
        }
        default: {
          const n = noticeForCustom(ev.name, ev.value);
          if (!n) return st;
          return { ...st, entries: [...st.entries, n] };
        }
      }
    }
    case "reply_end": {
      const r = lastReply(st);
      if (!r) return st;
      const next = { ...r, done: true, endedAt: Date.now(), error: ev.error?.message };
      return { ...st, entries: [...st.entries.slice(0, -1), next], busy: false, activeReplyId: null };
    }
    case "error": {
      const n: NoticeEntry = { kind: "notice", text: ev.message ?? "unknown error", level: "error" };
      return { ...st, entries: [...st.entries, n], busy: false };
    }
    case "exceed_max_iters": {
      const n: NoticeEntry = { kind: "notice", text: "max iterations reached", level: "warn" };
      return { ...st, entries: [...st.entries, n] };
    }
    default:
      return st;
  }
}

export function pushUser(st: ChatState, text: string): ChatState {
  return { ...st, entries: [...st.entries, { kind: "user", text }] };
}

function noticeForCustom(name: string | undefined, value: Record<string, unknown> | undefined): NoticeEntry | null {
  switch (name) {
    case "conversation_input_injected": {
      const inputs = Array.isArray(value?.inputs) ? (value.inputs as string[]).length : 1;
      return { kind: "notice", text: `↪ input steered into the running turn (${inputs} message${inputs === 1 ? "" : "s"})`, level: "info" };
    }
    case "conversation_turn_interrupted":
      return { kind: "notice", text: "turn interrupted — pending input drives the next turn", level: "warn" };
    case "compacted":
      return { kind: "notice", text: "context compacted", level: "info" };
    case "context_overflow_recovery":
      return { kind: "notice", text: "context overflow recovered: tool results truncated, summary forced", level: "warn" };
    case "conversation_turn_error":
      return { kind: "notice", text: `turn failed to start: ${String(value?.error ?? "unknown error")}`, level: "error" };
    default:
      return null;
  }
}

export function pushNotice(st: ChatState, text: string, level: NoticeEntry["level"] = "info"): ChatState {
  return { ...st, entries: [...st.entries, { kind: "notice", text, level }] };
}

export function toolFromBlock(b: ToolCallBlock): ToolEntry {
  return { id: b.id, name: b.name, input: b.input, output: "", state: "streaming" };
}
