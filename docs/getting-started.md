# Getting started

turnwright is a coding agent for the terminal. This page gets you from zero to a
running agent; the rest of the [docs](./) cover every feature in detail.

## Platform support

Prebuilt engine binaries ship for:

| OS | Architectures |
|---|---|
| macOS (darwin) | x64, arm64 |
| Linux | x64, arm64 |

<!-- src: scripts/build-dist.sh PLATFORMS -->

**Windows is not supported yet** — the launcher has no `.exe` handling and no
Windows engine packages are published. On Windows, run turnwright under WSL2.

## Install

### From npm (recommended)

```sh
npm i -g @turnwright/cli
```

The per-platform Go engine arrives automatically via npm
`optionalDependencies` (`@turnwright/engine-darwin-arm64`, etc.).

**Bun ≥ 1.4 must be on `PATH`.** The `turnwright` command is a Node launcher
that spawns the TUI with [bun](https://bun.sh) (OpenTUI needs `node:ffi`, which
Node < 26.1 lacks). Install it with `npm i -g bun` or `curl -fsSL
https://bun.sh/install | bash`.

### From source

Requirements:

- **Go 1.26+** — builds the engine (version per `go.mod`)
- **Bun ≥ 1.4** — runs the TUI
- **pnpm** — workspace installs (`corepack enable` gets you one)

```sh
git clone https://github.com/AlanFokCo/turnwright && cd turnwright
go build -o turnwright-engine ./cmd/turnwright-engine   # engine lands at repo root
pnpm install
pnpm dev                                                # TUI; forwards flags to the engine
pnpm dev -- --model qwen-plus --config none             # e.g. pick a model ad hoc
```

In a dev checkout the launcher finds `turnwright-engine` by walking up from the
TUI directory, so no install step is needed.

## Credentials

Set **one** LLM credential and turnwright auto-detects the provider:
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DASHSCOPE_API_KEY`,
`DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `MOONSHOT_API_KEY`, or `XAI_API_KEY`.
Local models via ollama need no key at all — just `--provider ollama
--model <name>`.

Each provider has a sensible default model; the authoritative table (providers,
defaults, keys) lives in [configuration](./configuration.md#providers--default-models).

<!-- src: internal/config/config.go pickDefaultModel / Load -->

Ollama needs no key: `--provider ollama` defaults the base URL to
`http://localhost:11434`. Any provider can be pointed at a proxy or gateway
with `--base-url` / `base_url` in config.

You can also select a provider explicitly (`--provider dashscope --model
qwen3-max`), which skips auto-detection. Full details:
[configuration](./configuration.md).

## First run

```sh
cd your-project
turnwright
```

You should see the welcome hero, a status line (model · branch · permission
mode · tokens), and the input prompt. Type a request and press `enter`:

```
> explain what this repo does
```

The agent reads files, proposes edits, and runs commands. Depending on the
permission mode (default: `accept_edits`) it either acts or pops an approval
dialog — `y` once, `n` deny, `a` always.

Useful first steps:

- `/help` — list slash commands
- `/status` — show session, model, permission mode, cwd
- `ctrl+c` — cancel the current turn (when idle, exits)
- `/quit` — exit

### Non-interactive (print) mode

The engine binary doubles as a one-shot CLI — handy for scripts and CI:

```sh
./turnwright-engine -p "explain this repo" --output text
```

Print mode cannot answer approval prompts, so anything requiring confirmation
is **denied automatically**; see [print mode](./print-mode.md) before using it
in CI.

If you run `turnwright-engine` with no `-p` prompt, it exits with an error
pointing you at `serve` (the LCP server the TUI talks to) or the npm package.

## Configuration file (optional)

Everything has sensible defaults; a config file is opt-in:

```toml
# ~/.turnwright/config.toml
provider   = "dashscope"
model      = "qwen3-max"
permission = "accept_edits"
```

See [configuration](./configuration.md) for every key, and
[theming & branding](./theming-and-branding.md) to rename/recolor the whole
product without touching code.

## Next

- [CLI reference](./cli-reference.md) — every flag and env var
- [TUI guide](./tui-guide.md) — keys, slash commands, permission modes, sessions
- [Skills, MCP & project setup](./skills-and-mcp.md) — extend the agent per project
- [Print mode](./print-mode.md) — scripting and CI
- [LCP protocol](./lcp-protocol.md) — build your own client
