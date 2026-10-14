import type { AgentEventLike } from "@/replay/events";

/** Canned-response brain for the interactive playground. Shapes mirror the
 *  real LCP event vocabulary (plus the player-side meta types) so the fake
 *  terminal behaves like the product, including its failure modes. */

export interface PlaygroundState {
  permission: string;
  theme: "dark" | "light";
}

export function initialPlaygroundState(): PlaygroundState {
  return { permission: "accept_edits", theme: "dark" };
}

const PERMISSION_MODES = ["default", "accept_edits", "explore", "bypass", "dont_ask"];

const HELP_TEXT = [
  "/help — list commands",
  "/model [name] — switch model",
  "/sessions — resume a saved session",
  "/theme [name] — switch theme",
  "/permission <mode> — set permission mode",
  "/status — show session status",
  "/vim — toggle vim keybindings",
  "/compact — compact context (pending upstream API)",
  "/clear — clear the conversation view",
  "/quit — exit",
].join("\n");

function notice(text: string, tone: "info" | "warn" | "error" = "info"): AgentEventLike[] {
  return [{ type: "system_notice", text, tone }];
}

export function playgroundRespond(
  input: string,
  st: PlaygroundState,
): { events: AgentEventLike[]; state: PlaygroundState } {
  const cmd = input.trim();

  if (cmd === "/help") return { events: notice(HELP_TEXT), state: st };

  if (cmd === "/status") {
    return {
      events: notice(`session demo · model claude-sonnet-4-5 · permission ${st.permission} · cwd /demo`),
      state: st,
    };
  }

  if (cmd.startsWith("/theme")) {
    const name = cmd.slice("/theme".length).trim() || "turnwright-dark";
    return {
      events: notice(`theme → ${name}`),
      state: { ...st, theme: name === "turnwright-light" ? "light" : "dark" },
    };
  }

  if (cmd.startsWith("/permission")) {
    const arg = cmd.slice("/permission".length).trim();
    if (!arg) {
      return { events: notice(`permission: ${st.permission} (modes: ${PERMISSION_MODES.join("|")})`), state: st };
    }
    if (!PERMISSION_MODES.includes(arg)) {
      return { events: notice(`permission: unknown mode "${arg}"`, "warn"), state: st };
    }
    return { events: notice(`permission → ${arg}`), state: { ...st, permission: arg } };
  }

  if (cmd.startsWith("/")) {
    return { events: notice(`unknown command: ${cmd.split(/\s+/)[0]} (try /help)`, "warn"), state: st };
  }

  if (/^run( the)? tests?$/.test(cmd)) {
    const call = { cmd: "go test ./..." };
    return {
      events: [
        { type: "reply_start", reply_id: "pg1" },
        { type: "tool_call_start", tool_call_id: "pgt1", tool_call_name: "bash", tool_call_input: JSON.stringify(call) },
        {
          type: "require_user_confirm",
          reply_id: "pg1",
          tool_calls: [
            {
              type: "tool_use", id: "pgt1", name: "bash", input: JSON.stringify(call), state: "pending",
              suggested_rules: [{ toolName: "bash", behavior: "allow", pattern: "go test *" }],
            },
          ],
        },
      ],
      state: st,
    };
  }

  // representative free-text turn
  return {
    events: [
      { type: "reply_start", reply_id: "pg2" },
      {
        type: "text_block_delta",
        block_id: "pgb1",
        delta: "In this demo the agent answers from a canned turn. ",
      },
      {
        type: "text_block_delta",
        block_id: "pgb1",
        delta: "Install turnwright to put the real thing in your terminal.",
      },
      { type: "model_call_end", input_tokens: 420, output_tokens: 38 },
      { type: "reply_end", finished_reason: "stop" },
    ],
    state: st,
  };
}

/** Continuation events once the user answers an approval prompt. */
export function approvalOutcome(decision: "once" | "deny" | "always", toolCallId: string): AgentEventLike[] {
  if (decision === "deny") {
    return [
      { type: "tool_policy_denied", tool_call_id: toolCallId, tool_call_name: "bash" },
      { type: "reply_end", finished_reason: "stop" },
    ];
  }
  const base: AgentEventLike[] = [
    { type: "tool_call_end", tool_call_id: toolCallId, state: "success" },
    { type: "tool_result_end", tool_call_id: toolCallId, message: "ok  ./internal/...  1.9s" },
  ];
  if (decision === "always") {
    base.push({ type: "system_notice", text: "rule added: bash “go test *” allowed for this session", tone: "info" });
  }
  base.push({ type: "reply_end", finished_reason: "stop" });
  return base;
}
