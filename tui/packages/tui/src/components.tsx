/** lathe TUI components. Every visual surface reads from Theme + Brand:
 *  rebranding or restyling never requires touching component code. */

import React from "react";
import type { Brand } from "@lathe/core";
import type { Theme } from "./theme.js";
import type { Entry, ReplyEntry, ToolEntry } from "./store.js";

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

export function MessageView({ entry, theme }: { entry: Entry; theme: Theme }) {
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
  return <ReplyView reply={entry} theme={theme} />;
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
      {reply.text !== "" && (
        <box marginTop={reply.thinking !== "" ? 1 : 0}>
          <text fg={theme.colors.text}>{reply.text}</text>
        </box>
      )}
      {reply.tools.map((t) => (
        <ToolCard key={t.id} tool={t} theme={theme} />
      ))}
      {reply.error && <text fg={theme.colors.danger}>{theme.icons.error} {reply.error}</text>}
    </box>
  );
}

function toolSummary(t: ToolEntry): string {
  try {
    const args = JSON.parse(t.input || "{}");
    const key = ["command", "path", "file_path", "pattern", "url"].find((k) => args[k]);
    return key ? String(args[key]).slice(0, 120) : "";
  } catch {
    return t.input.slice(0, 120);
  }
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
  return (
    <box flexDirection="column" marginTop={1}>
      <text>
        <span fg={fg}>{icon} </span>
        <span fg={theme.colors.text}><strong>{tool.name}</strong></span>
        <span fg={theme.colors.muted}>  {toolSummary(tool)}</span>
      </text>
    </box>
  );
}

export function ApprovalDialog({
  toolNames, theme,
}: { toolNames: string[]; theme: Theme }) {
  return (
    <box
      border borderColor={theme.colors.warn}
      paddingX={2} paddingY={1} marginX={1} marginTop={1}
      backgroundColor={theme.colors.surface}
      flexDirection="column"
    >
      <text fg={theme.colors.warn}><strong>Approval required</strong></text>
      {toolNames.map((n, i) => (
        <text key={i} fg={theme.colors.text}>  {theme.icons.tool} {n}</text>
      ))}
      <text fg={theme.colors.muted}>[y] allow once   [n] deny   [a] always allow</text>
    </box>
  );
}

export function StatusLine({
  theme, brand, model, busy, inTok, outTok, sessionId,
}: {
  theme: Theme; brand: Brand; model: string; busy: boolean;
  inTok: number; outTok: number; sessionId: string;
}) {
  return (
    <box backgroundColor={theme.colors.surface} paddingX={1} flexDirection="row">
      <text fg={theme.colors.accent}><strong>{brand.name}</strong></text>
      <text fg={theme.colors.muted}>  {model}  │  </text>
      <text fg={busy ? theme.colors.accent : theme.colors.muted}>
        {busy ? `${theme.icons.running} working` : "ready"}
      </text>
      <text fg={theme.colors.muted}>  │  ↑{inTok} ↓{outTok}  │  {sessionId.slice(0, 8)}</text>
    </box>
  );
}
