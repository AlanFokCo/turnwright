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

Set one LLM credential and go: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`DASHSCOPE_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY`,
`XAI_API_KEY` — or `--provider ollama` for local models.

## Make it yours

Everything user-visible is data-driven from `~/.turnwright/config.toml` —
forks rebrand by editing config, not code:

```toml
[brand]
name    = "my-agent"
tagline = "my tagline"
accent  = "#F59E0B"          # any hex color
logo    = ["┌┬┐ ┬ ┬", " │  │││", " ┴  └┴┘"]   # ASCII art, one string per line
theme   = "my-theme"         # ~/.turnwright/themes/my-theme.json
status  = ["busy", "model", "branch", "tokens"]   # status-line slot order
```

## Links

- Repo: <https://github.com/AlanFokCo/turnwright>
- Issues: <https://github.com/AlanFokCo/turnwright/issues>
