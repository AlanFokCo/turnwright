/** turnwright TUI components. Every visual surface reads from Theme + Brand:
 *  rebranding or restyling never requires touching component code. */

import React, { useMemo } from "react";
import { useRenderer } from "@opentui/react";
import type { Brand, ToolCallBlock } from "@turnwright/core";
import type { Theme } from "./theme.js";
import type { Entry, PlanState, ReplyEntry, ShellEntry, ToolEntry } from "./store.js";
import { makeMarkdownStyle } from "./markdown.js";

export function WelcomeHero({ brand, theme }: { brand: Brand; theme: Theme }) {
  return (
    <box flexDirection="column" marginBottom={1} paddingX={1}>
      {brand.logo.map((line, i) => (
        <text key={i} fg={theme.colors.accent}>{line}</text>
      ))}
      <text>
        <span fg={theme.colors.text}><strong>{brand.name}</strong></span>
        <span fg={theme.colors.muted}>  {brand.tagline}</span>
      </text>
    </box>
  );
}

export const MessageView = React.memo(function MessageView({ entry, theme }: { entry: Entry; theme: Theme }) {
  if (entry.kind === "user") {
    return (
      <box marginTop={1} paddingX={1}>
        <text>
          <span fg={theme.colors.accent}>{theme.icons.user} </span>
          <span fg={theme.colors.text}><strong>{entry.text}</strong></span>
        </text>
      </box>
    );
  }
  if (entry.kind === "notice") {
    const fg = entry.level === "error" ? theme.colors.danger
      : entry.level === "warn" ? theme.colors.warn : theme.colors.info;
    return (
      <box paddingX={1}>
        <text fg={fg}>{entry.text}</text>
      </box>
    );
  }
  if (entry.kind === "shell") {
    return <ShellView entry={entry} theme={theme} />;
  }
  return <ReplyView reply={entry} theme={theme} />;
});

/** A user-initiated `!` command: ran outside the model loop, output shown as-is. */
function ShellView({ entry, theme }: { entry: ShellEntry; theme: Theme }) {
  const fg = entry.done && entry.exitCode === 0 ? theme.colors.success
    : entry.done ? theme.colors.danger : theme.colors.accent;
  const icon = entry.done ? (entry.exitCode === 0 ? theme.icons.success : theme.icons.error) : theme.icons.running;
  const lines = entry.output.split("\n");
  const preview = lines.slice(0, 12).join("\n");
  return (
    <box flexDirection="column" marginTop={1} paddingX={1}>
      <text>
        <span fg={fg}>{icon} </span>
        <span fg={theme.colors.muted}>$ </span>
        <span fg={theme.colors.text}><strong>{entry.command}</strong></span>
        {entry.done && <span fg={fg}>  exit {entry.exitCode}</span>}
      </text>
      {preview !== "" && (
        <box marginLeft={2}>
          <text fg={theme.colors.text}>{preview}{lines.length > 12 ? "\n…" : ""}</text>
        </box>
      )}
    </box>
  );
}

/** The model-maintained step plan (update_plan), shown while set (codex parity). */
export function PlanPanel({ plan, theme }: { plan: PlanState; theme: Theme }) {
  const iconFor = (status: string) =>
    status === "completed" ? theme.icons.success
    : status === "in_progress" ? theme.icons.running
    : status === "cancelled" ? theme.icons.error
    : "○";
  const fgFor = (status: string) =>
    status === "completed" ? theme.colors.muted
    : status === "in_progress" ? theme.colors.accent
    : status === "cancelled" ? theme.colors.danger
    : theme.colors.muted;
  return (
    <box flexDirection="column" marginX={1} paddingX={1} flexShrink={0} border borderColor={theme.colors.border}>
      <text fg={theme.colors.muted}>plan</text>
      {plan.explanation !== undefined && plan.explanation !== "" && (
        <text fg={theme.colors.muted}>{plan.explanation}</text>
      )}
      {plan.steps.map((s, i) => (
        <text key={i}>
          <span fg={fgFor(s.status)}>{iconFor(s.status)} </span>
          <span fg={fgFor(s.status)}>{s.step}</span>
        </text>
      ))}
    </box>
  );
}

/** MCP elicitation: a server asks the user for input mid tool call. */
export function ElicitDialog({ message, theme }: { message: string; theme: Theme }) {
  return (
    <box
      border borderColor={theme.colors.warn}
      paddingX={2} paddingY={1} marginX={1} marginTop={1}
      backgroundColor={theme.colors.surface} flexShrink={0}
      flexDirection="column"
    >
      <text fg={theme.colors.warn}><strong>Server requests input</strong></text>
      <text fg={theme.colors.text}>{message}</text>
      <text fg={theme.colors.muted}>type an answer and [y] submit · [n] decline</text>
    </box>
  );
}

function Markdown({ text, theme }: { text: string; theme: Theme }) {
  const renderer = useRenderer();
  const style = useMemo(() => makeMarkdownStyle(renderer, theme), [renderer, theme]);
  if (!style) {
    return <text fg={theme.colors.text}>{text}</text>;
  }
  return <markdown content={text} syntaxStyle={style} />;
}

function ReplyView({ reply, theme }: { reply: ReplyEntry; theme: Theme }) {
  return (
    <box flexDirection="column" marginTop={1} paddingX={1}>
      {reply.thinking !== "" && (
        <text fg={theme.colors.muted}>
          {theme.icons.thinking} Thought{reply.done ? "" : "…"}
          {reply.thinkingCollapsed ? "" : `: ${reply.thinking.slice(0, 200)}`}
        </text>
      )}
      {reply.segments.map((seg, i) => {
        if (seg.kind === "text") {
          if (seg.text.trim() === "") return null;
          return (
            <box key={`t${i}`} marginTop={i === 0 && reply.thinking === "" ? 0 : 1}>
              <Markdown text={seg.text} theme={theme} />
            </box>
          );
        }
        const tool = reply.tools.find((t) => t.id === seg.toolId);
        return tool ? <ToolCard key={seg.toolId} tool={tool} theme={theme} /> : null;
      })}
      {reply.segments.length === 0 && reply.text !== "" && (
        <box marginTop={reply.thinking !== "" ? 1 : 0}>
          <Markdown text={reply.text} theme={theme} />
        </box>
      )}
      {reply.error && <text fg={theme.colors.danger}>{theme.icons.error} {reply.error}</text>}
    </box>
  );
}

export function toolSummary(input: string): string {
  try {
    const args = JSON.parse(input || "{}");
    const key = ["command", "path", "file_path", "pattern", "url", "query"].find((k) => args[k]);
    return key ? String(args[key]).slice(0, 100) : "";
  } catch {
    return input.slice(0, 100);
  }
}

function looksLikeDiff(s: string): boolean {
  return /^diff --git /m.test(s) || /^@@ -\d+/m.test(s) || /^--- a\//m.test(s);
}

function ToolCard({ tool, theme }: { tool: ToolEntry; theme: Theme }) {
  const icon = tool.state === "success" ? theme.icons.success
    : tool.state === "error" ? theme.icons.error
    : tool.state === "denied" ? theme.icons.warn
    : theme.icons.running;
  const fg = tool.state === "success" ? theme.colors.success
    : tool.state === "error" ? theme.colors.danger
    : tool.state === "denied" ? theme.colors.warn
    : theme.colors.accent;
  const lines = tool.output.split("\n");
  const preview = lines.slice(0, 8).join("\n");
  const truncated = lines.length > 8;
  // A successful command should still SHOW something: a wall of bare command
  // cards reads as a stuck session. Three muted lines of its output give the
  // user feedback without flooding the transcript.
  const successPreview = lines.slice(0, 3)
    .map((l) => (l.length > 100 ? l.slice(0, 100) + "…" : l))
    .filter((l) => l.trim() !== "")
    .join("\n");
  return (
    <box flexDirection="column" marginTop={1}>
      <text>
        <span fg={fg}>{icon} </span>
        <span fg={theme.colors.text}><strong>{tool.name}</strong></span>
        <span fg={theme.colors.muted}>  {toolSummary(tool.input)}</span>
      </text>
      {tool.state === "error" && preview !== "" && (
        <box marginLeft={2}>
          <text fg={theme.colors.danger}>{preview}{truncated ? "\n…" : ""}</text>
        </box>
      )}
      {tool.state === "success" && looksLikeDiff(tool.output) && (
        <box marginLeft={2}>
          <diff diff={preview} view="unified" />
        </box>
      )}
      {tool.state === "success" && !looksLikeDiff(tool.output) && successPreview !== "" && (
        <box marginLeft={2}>
          <text fg={theme.colors.muted}>
            {successPreview}
            {lines.length > 3 ? "\n…" : ""}
          </text>
        </box>
      )}
    </box>
  );
}

export function ApprovalDialog({
  toolCalls, theme,
}: { toolCalls: ToolCallBlock[]; theme: Theme }) {
  return (
    <box
      border borderColor={theme.colors.warn}
      paddingX={2} paddingY={1} marginX={1} marginTop={1}
      backgroundColor={theme.colors.surface} flexShrink={0}
      flexDirection="column"
    >
      <text fg={theme.colors.warn}><strong>Approval required</strong></text>
      {toolCalls.map((tc, i) => (
        <box key={i} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
          <text>
            <span fg={theme.colors.text}><strong>{theme.icons.tool} {tc.name}</strong></span>
            <span fg={theme.colors.muted}>  {toolSummary(tc.input)}</span>
          </text>
        </box>
      ))}
      <text fg={theme.colors.muted}>[y] allow once   [n] deny   [a] always allow</text>
    </box>
  );
}

export function StatusLine({
  theme, brand, model, busy, busySecs, inTok, outTok, tokPerSec, sessionId, branch, permission, vimMode, spinner, width,
}: {
  theme: Theme; brand: Brand; model: string; busy: boolean;
  busySecs: number; inTok: number; outTok: number; tokPerSec: number | null;
  sessionId: string; branch: string; permission: string;
  vimMode?: "insert" | "normal" | null;
  spinner: string;
  width: number;
}) {
  const c = theme.colors;
  const slot = (s: string): React.ReactNode => {
    switch (s) {
      case "busy":
        return (
          <text fg={busy ? c.accent : c.muted}>
            {busy ? `${spinner} working ${busySecs}s` : "ready"}
          </text>
        );
      case "model": return <text fg={c.muted}>{model}</text>;
      case "branch": return branch ? <text fg={c.muted}>⎇ {branch}</text> : null;
      case "permission": return <text fg={c.muted}>{permission}</text>;
      case "tokens": return <text fg={c.muted}>↑{inTok} ↓{outTok}</text>;
      case "toks":
        return tokPerSec !== null ? <text fg={c.muted}>{tokPerSec} tok/s</text> : null;
      case "session": return <text fg={c.muted}>{sessionId.slice(0, 8)}</text>;
      default: return null;
    }
  };
  const order = brand.status?.length
    ? brand.status
    : ["busy", "model", "branch", "permission", "tokens", "toks", "session"];
  // narrow terminals drop low-priority slots instead of wrapping mid-token
  const minWidth: Record<string, number> = {
    busy: 0, model: 0, permission: 58, branch: 68, tokens: 76, toks: 84, session: 92,
  };
  const visible = order.filter((s) => width >= (minWidth[s] ?? 72));
  return (
    <box backgroundColor={c.surface} paddingX={1} flexDirection="row" flexShrink={0}>
      <text fg={c.accent}><strong>{brand.name}</strong></text>
      {vimMode && (
        <text fg={vimMode === "normal" ? c.warn : c.muted}>
          {vimMode === "normal" ? "  NORM" : "  INS"}
        </text>
      )}
      {visible.map((s, i) => {
        const node = slot(s);
        if (node === null) return null;
        return (
          <box key={s} flexDirection="row">
            <text fg={c.border}>{i === 0 ? "   " : "  │  "}</text>
            {node}
          </box>
        );
      })}
    </box>
  );
}
