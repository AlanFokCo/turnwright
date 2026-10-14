/** Chapter markers for the canonical replay (t offsets in ms, must match
 *  canonical.json). Two player-side meta event types appear in scripts —
 *  `user_message {text}` and `system_notice {text, tone?}` — because the
 *  upstream 14-type AgentEvent vocabulary has no carrier for the user's own
 *  lines or TUI notices. The player also flips its light class when a notice
 *  reading "theme → turnwright-light" passes. */
export const CHAPTERS = [
  { id: "stream", label: "Streaming", tStart: 0 },
  { id: "tools", label: "Tool calls", tStart: 7000 },
  { id: "approval", label: "Approval", tStart: 14000 },
  { id: "diff", label: "The patch", tStart: 21000 },
  { id: "theme", label: "Theme switch", tStart: 27500 },
] as const;

export type Chapter = (typeof CHAPTERS)[number];
