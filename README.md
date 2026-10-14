# turnwright

> A common coding agent for the terminal — in the mold of Claude Code, Codex
> CLI, and qwen-code — assembled entirely on
> [agentscope-go](https://github.com/agentscope-ai/agentscope-go), with a
> TypeScript TUI.

**Site:** <https://alanfokco.github.io/turnwright/> — product tour, live
terminal demos, and the full documentation.

turnwright is deliberately **two halves bolted together by a protocol**:

- **`turnwright-engine` (Go)** — a thin assembly layer over agentscope-go. The agent
  loop, tools, permissions, sessions, skills, MCP, and context compression all
  come from agentscope-go; turnwright writes none of that itself, it only wires
  blocks together and exposes them over **LCP** (JSON-RPC 2.0 NDJSON on stdio).
- **`turnwright` TUI (TypeScript)** — an [OpenTUI](https://github.com/sst/opentui)
  + React client of LCP. It renders the stream, collects input, and never
  touches engine internals.

Because every capability crosses one JSON-RPC seam, the TUI is replaceable and
the engine is testable without a terminal — see the
[LCP protocol reference](docs/lcp-protocol.md).

## Status

Pre-release (alpha). v2 rebuild:

- **M0–M2** monorepo, LCP protocol, engine on agentscope-go `main`, TUI skeleton
- **M3** feature parity: slash commands, `@file` expansion, `/model`,
  session picker, themes, diff view, vim mode, approvals
- **M4** quality sprint — rubric 43/50:
  16ms stream batching, interleaved text/tool rendering, resize-safe layout,
  NO_COLOR + 16-color fallbacks, splash-first startup
- **M5** npm distribution (per-platform engine binaries), CI

## Install

```sh
npm i -g @turnwright/cli        # engine arrives via per-platform optionalDependencies
turnwright                      # requires bun ≥1.4 on PATH (OpenTUI needs node:ffi)
```

macOS and Linux (x64/arm64) are supported; Windows runs under WSL2 for now.
Set one LLM credential (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`DASHSCOPE_API_KEY`, …) or use `--provider ollama` for local models.
Step by step: **[getting started](docs/getting-started.md)**.

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | Install, platforms, credentials, first run |
| [CLI reference](docs/cli-reference.md) | Every flag and env var, launcher vs engine |
| [Configuration](docs/configuration.md) | `config.toml`, precedence, providers & default models |
| [TUI guide](docs/tui-guide.md) | Keys, slash commands, permission modes, `@file`, sessions, vim |
| [Skills, MCP & project setup](docs/skills-and-mcp.md) | CLAUDE.md/AGENTS.md instructions, skills, `.mcp.json` |
| [Print mode](docs/print-mode.md) | Non-interactive `-p`, stream-json, CI usage |
| [Theming & branding](docs/theming-and-branding.md) | Theme overrides, `[brand]` rebranding for forks |
| [LCP protocol](docs/lcp-protocol.md) | JSON-RPC seam — build your own client |

Quick taste:

```toml
# ~/.turnwright/config.toml — all optional
provider   = "dashscope"
model      = "qwen3-max"
permission = "accept_edits"

[brand]                          # rebrand the whole product without touching code
name    = "myagent"
tagline = "ships code, asks questions later"
accent  = "#7C3AED"
theme   = "myagent-dark"         # ~/.turnwright/themes/myagent-dark.json
```

TUI keys in one line: `enter` send · `tab` complete · `ctrl+c` cancel the turn
(when idle: quit) · approvals `y`/`n`/`a` — full list in the
[TUI guide](docs/tui-guide.md).

## Run from source

Requirements: Go 1.26+ (per `go.mod`), Bun ≥ 1.4, pnpm.

```sh
go build -o turnwright-engine ./cmd/turnwright-engine   # engine lands at repo root
pnpm install
pnpm dev                                     # TUI; forwards flags to engine
pnpm dev -- --model qwen-plus --config none  # e.g. pick a model ad hoc
```

Non-interactive print mode (no TUI):

```sh
./turnwright-engine -p "explain this repo" --output text         # or stream-json
```

## Development

```sh
go test ./internal/...         # engine, hermetic (mock model)
pnpm --filter @turnwright/tui test:ui   # TUI interaction tests (bun)
pnpm typecheck
```

Release builds:

```sh
bash scripts/build-dist.sh           # TUI bundle + engines for darwin/linux × x64/arm64
```
