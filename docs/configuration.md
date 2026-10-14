# Configuration

All runtime configuration is optional — turnwright works with just an API key
in the environment. When you do configure it, three layers meet:

```
CLI flags  >  ~/.turnwright/config.toml  >  built-in defaults
                      (+ env vars for a few keys, see below)
```

## The config file

Default path: `~/.turnwright/config.toml`.

- `--config /path/to/other.toml` loads a different file
- `--config none` skips config files entirely (flags + env + defaults only) —
  useful for reproducible runs and CI

A fully-populated example:

```toml
provider   = "dashscope"          # anthropic|openai|dashscope|deepseek|gemini|moonshot|kimi|xai|ollama
model      = "qwen3-max"          # provider default when empty
base_url   = ""                   # proxy/gateway override
api_key    = ""                   # env var strongly preferred
permission = "accept_edits"       # default|accept_edits|explore|bypass|dont_ask
max_iters  = 50                   # max agent loop iterations

prompt_caching = false            # Anthropic prompt caching (Anthropic only)
context_size   = 0                # context-window override, tokens (ollama only)

# Reserved — parsed but not yet wired (pending agentscope-go APIs):
# thinking, thinking_budget, effort, jail, compact_ratio

[brand]
name    = "turnwright"
tagline = "shape your code at the lathe"
accent  = "#F59E0B"               # any hex color
logo    = ["┌┬┐ ┬ ┬", " │  │││", " ┴  └┴┘"]   # ASCII art, one string per line
theme   = "turnwright-dark"
# status = ["busy", "model", "branch", "permission", "tokens", "toks", "session"]
```

<!-- src: internal/config/toml.go TOMLFile / internal/config/config.go Brand -->

## Keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `provider` | string | env auto-detect | Provider names: see table below |
| `model` | string | provider default | See per-provider defaults below |
| `base_url` | string | provider default | Proxy/gateway; ollama defaults to `http://localhost:11434` |
| `api_key` | string | — | Env var preferred; file is world-readable risk |
| `permission` | string | `accept_edits` | Modes: [TUI guide](./tui-guide.md#permission-modes) |
| `max_iters` | int | `50` | Agent loop iteration cap; exceeding it ends the turn with an `exceed_max_iters` event |
| `prompt_caching` | bool | `false` | Anthropic only; ignored by other providers |
| `context_size` | int | model card | **ollama only** — passed to the ollama client; other providers ignore it |
| `thinking` | bool | `false` | *Reserved, not yet wired* |
| `thinking_budget` | int | 4096 when thinking on | *Reserved, not yet wired* |
| `effort` | string | provider default | *Reserved, not yet wired* |
| `jail` | bool | `false` | *Reserved, not yet wired* |
| `compact_ratio` | float | engine default | *Reserved, not yet wired* (clamped to ≤ 0.95). Agent-driven auto-compaction is always active |

<!-- src: internal/config/config.go Load (defaults) / mergeTOMLIntoFlags -->

### `[brand]`

Rebrands the whole product (welcome hero, status line, terminal title) without
touching code. Fields: `name`, `tagline`, `accent` (hex), `logo` (array of
ASCII-art lines), `theme`, `status` (status-line slot order). Full guide:
[theming & branding](./theming-and-branding.md).

## Precedence (the real rules)

The headline is "flag > env > TOML > defaults", but the layers combine
differently per key type:

<!-- src: internal/config/config.go Load + mergeTOMLIntoFlags -->

- **Most keys** (`provider`, `model`, `base_url`, `api_key`, `permission`,
  `max_iters`, `context_size`, `compact_ratio`): **flag > TOML**. No env var
  participates — except API-key auto-detection, which kicks in only when the
  key is still empty after flag+TOML.
- **Booleans** (`thinking`, `jail`, `prompt_caching`): **or-combined** across
  flag, TOML, and `TURNWRIGHT_*` env var. If any layer sets it true, it is
  true — a later layer cannot turn it off.
- **`effort`**: **flag > TOML > env** (`TURNWRIGHT_EFFORT` fills the gap only
  when both are empty).

## Providers & default models

| `provider` | Default model | Credential env var |
|---|---|---|
| `anthropic` | `claude-sonnet-4-5` | `ANTHROPIC_API_KEY` |
| `openai` | `gpt-4o-mini` | `OPENAI_API_KEY` |
| `dashscope` | `qwen-plus` | `DASHSCOPE_API_KEY` |
| `deepseek` | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| `gemini` | `gemini-2.5-flash` | `GEMINI_API_KEY` |
| `moonshot` / `kimi` | `kimi-k2.7-code` | `MOONSHOT_API_KEY` |
| `xai` | `grok-4-fast` | `XAI_API_KEY` |
| `ollama` | — (`--model` required) | none (key defaults to the literal `ollama`) |

<!-- src: internal/config/config.go pickDefaultModel — treat that function as canonical -->

Without `--provider`, the engine scans the credential env vars above and uses
whichever is set. With `--provider`, the matching env var (or `--api-key` /
`api_key`) must be available — except ollama, which needs no key.

`kimi` is an alias of `moonshot` (same wire protocol).

## The `~/.turnwright` directory

| Path | Purpose |
|---|---|
| `config.toml` | This file |
| `themes/<name>.json` | Theme overrides ([theming](./theming-and-branding.md)) |
| `skills/<skill>/SKILL.md` | Global skills ([skills & MCP](./skills-and-mcp.md)) |
| `mcp.json` | Global MCP servers ([skills & MCP](./skills-and-mcp.md)) |
| `projects/<enc-cwd>/<session>.json` | Session transcripts; `<enc-cwd>` is the working directory with `/` and spaces replaced by `-` ([sessions](./tui-guide.md#sessions)) |

## Environment variables (complete list)

Runtime env vars not covered above live in the
[CLI reference](./cli-reference.md#engine-env-vars): provider keys,
`TURNWRIGHT_LOG_LEVEL`, `TURNWRIGHT_ENGINE`, `TURNWRIGHT_TIMING`, `NO_COLOR`,
and the reserved `TURNWRIGHT_THINKING` / `TURNWRIGHT_THINKING_BUDGET` /
`TURNWRIGHT_EFFORT` / `TURNWRIGHT_JAIL` / `TURNWRIGHT_PROMPT_CACHING`.
