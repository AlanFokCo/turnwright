# CLAUDE.md

turnwright v2: a coding-agent CLI in the mold of codex / claude-code. **All agent
capability comes from agentscope-go** (UnifiedAgent, permissions, compression,
skills, MCP, sessions) — turnwright is a pure assembly layer plus a TypeScript TUI.
Design doc: `docs/design/v2-redesign.md`.

## Layout

- `cmd/turnwright-engine/` — Go engine binary entry (cobra): `serve` (LCP stdio
  server for the TUI) and `-p` print mode.
- `internal/config` — flag > env > TOML (`~/.turnwright/config.toml`) resolution,
  incl. the `[brand]` section (name/tagline/accent/logo/theme).
- `internal/assemble` — the heart: builds `agent.UnifiedAgent` from config
  (model factory for 9 providers, EnhancedToolkit, permission.Context with
  project rules, skills via `skill.LocalSkillLoader`, MCP via `.mcp.json`,
  agent-driven compression). `AgentWithModel` is the test seam.
- `internal/transcript` — file-backed `agent.StateSaver`:
  `~/.turnwright/projects/<enc-cwd>/<session>.json`.
- `internal/lcp` — Turnwright Core Protocol server: JSON-RPC 2.0 NDJSON over stdio.
  agentscope events forward 1:1 as `agent/event` notifications (via
  `internal/eventjson`); `require_user_confirm` becomes a server→client
  `approval/request` answered via `agent.SubmitUserConfirm`.
- `internal/printmode` — non-interactive `-p` (text | stream-json).
- `tui/packages/core` — LCP client (`EngineClient`).
- `tui/packages/tui` — OpenTUI + React app (theme system, store, components).
- `tui/packages/cli` — npm launcher (`bin/turnwright.js`).

## Hard rules

- Do NOT implement agent capabilities in turnwright (no own turn loop, permission
  engine, compaction, session store, task subagent, hooks). If a capability is
  missing, wire the agentscope-go equivalent; only genuine glue belongs here.
- agentscope-go is pinned to a `main` pseudo-version
  (`github.com/agentscope-ai/agentscope-go/v2`); upgrade deliberately with
  `go get github.com/agentscope-ai/agentscope-go/v2@main` + full test run.
- Never call `as.Init()` (it prints to stdout and would corrupt LCP framing).
  `internal/assemble` sets up `logging.Init` on stderr instead.
- stdout is the LCP channel in serve mode; nothing but protocol frames there.

## Build, test, run

- Engine: `go build -o turnwright-engine ./cmd/turnwright-engine` · test: `go test ./...`
  (hermetic via `agenttest.MockModel`; no API key needed)
- TUI: `pnpm install && pnpm dev` — needs **Bun ≥1.4** runtime for OpenTUI
  (Node < 26.1 lacks `node:ffi`; OpenTUI uses bun:ffi). Dev runner: `bun
  tui/packages/tui/src/index.tsx`; engine auto-resolved from repo root.
- Print mode: `./turnwright-engine -p "..." --output stream-json`.

## Git workflow constraint

This machine cannot reach GitHub. Commits/pushes happen on
`ssh root@***.***.***.***` (`/root/turnwright`, identity AlanFokCo /
alanfok2868@gmail.com): rsync the working tree (including `.git`) there, then
commit/push from the remote.

## Conventions

- LCP protocol changes bump `ProtocolVersion` in `internal/lcp` and
  `tui/packages/core/src/protocol.ts` together.
- Theming/branding is data-driven (`[brand]` config + `~/.turnwright/themes/*.json`);
  do not hardcode colors in TS components — read from `Theme`.
