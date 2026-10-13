# lathe

> A common coding agent for the terminal — in the mold of Claude Code, Codex
> CLI, and qwen-code — assembled entirely on
> [agentscope-go](https://github.com/agentscope-ai/agentscope-go), with a
> TypeScript TUI.

lathe is deliberately **two halves bolted together by a protocol**:

- **`lathe-engine` (Go)** — a thin assembly layer over agentscope-go. The agent
  loop, tools, permissions, sessions, skills, MCP, and context compression all
  come from agentscope-go; lathe writes none of that itself, it only wires
  blocks together and exposes them over **LCP** (JSON-RPC 2.0 NDJSON on stdio).
- **`lathe` TUI (TypeScript)** — an [OpenTUI](https://github.com/sst/opentui)
  + React client of LCP. It renders the stream, collects input, and never
  touches engine internals.

Because every capability crosses one JSON-RPC seam, the TUI is replaceable and
the engine is testable without a terminal.

## Status

Pre-release. v2 rebuild in progress:

- **M0–M2** monorepo, LCP protocol, engine on agentscope-go `main`, TUI skeleton
- **M3** feature parity: slash commands, `@file` expansion, `/model`,
  session picker, themes, diff view, vim mode, approvals
- **M4/M5** (next) visual-quality sprint, npm distribution, CI

## Requirements

- **Go 1.25+** to build the engine
- **Bun ≥ 1.4** to run the TUI from source (OpenTUI needs `node:ffi`; Node < 26
  won't do)
- One LLM credential, e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `DASHSCOPE_API_KEY`, … or `--provider ollama`

## Run from source

```sh
go build -o lathe-engine ./cmd/lathe-engine   # engine lands at repo root
pnpm install
pnpm dev                                     # TUI; forwards flags to engine
pnpm dev -- --model qwen-plus --config none  # e.g. pick a model ad hoc
```

Non-interactive print mode (no TUI):

```sh
./lathe-engine -p "explain this repo" --output text         # or stream-json
```

## Config

`~/.lathe/config.toml` — all optional:

```toml
provider   = "dashscope"
model      = "qwen3-max"
permission = "accept_edits"   # default|accept_edits|explore|bypass|dont_ask

# Rebrand the whole product without touching code — forks start here.
[brand]
name    = "myagent"
tagline = "ships code, asks questions later"
accent  = "#7C3AED"
logo    = ["█▀▄▀█ █▄█", "█ ▀ █  █ "]
theme   = "lathe-dark"
```

Themes are JSON files in `~/.lathe/themes/<name>.json` that override semantic
color slots, the icon set, and motion flags; `[brand] accent` repaints the
accent everywhere. `/theme <name>` switches live.

## TUI keys

- `enter` send · `tab` complete slash-commands and `@paths`
- `pageup/pagedown` scroll · `ctrl+c` cancel the turn (twice to quit)
- approvals: `y` once · `n` deny · `a` always
- `/vim` — vim keybindings for the input (`esc`/`ctrl+g` → normal mode with
  block cursor; `i a A I` back to insert)

## Development

```sh
go test ./internal/...         # engine, hermetic (mock model)
pnpm --filter @lathe/tui test:ui   # TUI interaction tests (bun)
pnpm typecheck
```

Design rationale and the milestone plan live in
[`docs/design/v2-redesign.md`](docs/design/v2-redesign.md).
