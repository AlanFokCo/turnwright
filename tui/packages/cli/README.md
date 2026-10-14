# @turnwright/cli

> **turnwright** — a common coding agent for the terminal, in the mold of
> Claude Code, Codex CLI, and qwen-code. Assembled entirely on
> [agentscope-go](https://github.com/agentscope-ai/agentscope-go); the TUI is
> [OpenTUI](https://github.com/sst/opentui) + React. Fully brandable —
> *shape your code at the lathe.*

## Install

```sh
npm i -g @turnwright/cli   # per-platform Go engine arrives via optionalDependencies
turnwright                 # requires bun ≥ 1.4 on PATH
```

macOS and Linux (x64/arm64); Windows via WSL2 for now.

Set one LLM credential and go: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`DASHSCOPE_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY`,
`XAI_API_KEY` — or `--provider ollama` for local models.

```sh
turnwright                          # interactive TUI
turnwright --continue               # resume the newest session in this project
```

Non-interactive one-shots run through the engine binary (not on `PATH` from
npm — build from source, or use the per-platform package's
`bin/turnwright-engine`; details in the
[print-mode docs](https://github.com/AlanFokCo/turnwright/blob/main/docs/print-mode.md#getting-the-engine-binary)):

```sh
turnwright-engine -p "explain this repo" --output text
```

## Make it yours

Everything user-visible is data-driven from `~/.turnwright/config.toml` —
forks rebrand by editing config, not code:

```toml
[brand]
name    = "my-agent"
tagline = "my tagline"
accent  = "#F59E0B"          # any hex color
logo    = ["┌┬┐ ┬ ┬", " │  │││", " ┴  └┴┘"]   # ASCII art, one string per line
theme   = "my-theme"         # any name; ~/.turnwright/themes/my-theme.json
                             # overrides colors/icons/motion over the builtin base
status  = ["busy", "model", "branch", "tokens"]   # status-line slot order
```

## Documentation

- [Getting started](https://github.com/AlanFokCo/turnwright/blob/main/docs/getting-started.md)
- [CLI reference](https://github.com/AlanFokCo/turnwright/blob/main/docs/cli-reference.md) — every flag and env var
- [Configuration](https://github.com/AlanFokCo/turnwright/blob/main/docs/configuration.md) — `config.toml`, providers, precedence
- [TUI guide](https://github.com/AlanFokCo/turnwright/blob/main/docs/tui-guide.md) — keys, slash commands, permission modes, sessions
- [Skills, MCP & project setup](https://github.com/AlanFokCo/turnwright/blob/main/docs/skills-and-mcp.md)
- [Print mode / CI](https://github.com/AlanFokCo/turnwright/blob/main/docs/print-mode.md)
- [Theming & branding](https://github.com/AlanFokCo/turnwright/blob/main/docs/theming-and-branding.md)
- [LCP protocol](https://github.com/AlanFokCo/turnwright/blob/main/docs/lcp-protocol.md) — build your own client

## Links

- Repo: <https://github.com/AlanFokCo/turnwright>
- Issues: <https://github.com/AlanFokCo/turnwright/issues>
