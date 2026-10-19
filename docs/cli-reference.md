# CLI reference

Two binaries, two sections: **`turnwright`** is the npm launcher you normally
use (it starts the TUI); **`turnwright-engine`** is the Go engine underneath
(print mode, `serve` mode, all model/permission flags).

## `turnwright` (npm launcher)

Installed by `npm i -g @turnwright/cli`. A small Node script that resolves the
engine, then spawns the TUI under **bun** (which must be on `PATH`, ≥ 1.4).

### Arguments

The launcher consumes only three arguments itself; **everything else is
forwarded verbatim to `turnwright-engine serve`**:

<!-- src: tui/packages/tui/src/index.tsx parseArgs -->

| Argument | Effect |
|---|---|
| `--resume <id>` | Resume a saved session by id |
| `--continue` | Resume the most recently modified session in this project |
| `--no-anim` | Disable UI animations |

```sh
turnwright                                  # new session
turnwright --continue                       # pick up where you left off
turnwright --resume 0a1b2c3d… --model gpt-4o-mini
```

### Engine resolution order

<!-- src: tui/packages/cli/bin/turnwright.js resolveEngine -->

1. `$TURNWRIGHT_ENGINE` (if the file exists)
2. `turnwright-engine` found by walking up from the launcher (dev checkouts)
3. The per-platform npm package `@turnwright/engine-<platform>-<arch>`
4. `turnwright-engine` on `PATH`

### Launcher env vars

| Variable | Effect |
|---|---|
| `TURNWRIGHT_ENGINE` | Absolute path to the engine binary to use |
| `TURNWRIGHT_TIMING` | Any value: print startup timing marks to stderr |

## `turnwright-engine` (Go engine)

Two modes:

- `turnwright-engine -p "…"` — **print mode**: one non-interactive turn
  ([details](./print-mode.md))
- `turnwright-engine serve` — **LCP stdio server** for the TUI or any custom
  client ([protocol](./lcp-protocol.md)). The npm launcher runs this for you;
  you only call it directly when building your own client.

Running the bare engine with no `-p` prints an error and exits non-zero.

### Flags

All flags are persistent (accepted by both the root command and `serve`).
Cobra also provides `--help` and `--version`.

<!-- src: cmd/turnwright-engine/main.go newRootCmd — verify with `turnwright-engine --help` -->

| Flag | Values | Effect |
|---|---|---|
| `-p`, `--prompt` | string | Non-interactive prompt; switches to print mode |
| `--provider` | `anthropic` \| `openai` \| `dashscope` \| `deepseek` \| `gemini` \| `moonshot` \| `kimi` \| `xai` \| `ollama` | Select the LLM provider (skips env auto-detect). `kimi` is an alias of `moonshot` |
| `--model` | string | Model name; provider default when empty |
| `--api-key` | string | API key (env vars preferred) |
| `--base-url` | string | Provider base URL override (proxies, gateways). Ollama defaults to `http://localhost:11434` |
| `--permission` | `default` \| `accept_edits` \| `explore` \| `bypass` \| `dont_ask` | Permission mode; default `accept_edits`. Semantics: [TUI guide](./tui-guide.md#permission-modes) |
| `--output` | `text` \| `stream-json` | Print-mode output format (default `text`) |
| `--max-iters` | int | Max agent loop iterations (default 50) |
| `--resume` | string | Resume session by id |
| `--continue` | bool | Continue newest session in this project (`--resume` wins if both given) |
| `--prompt-caching` | bool | Anthropic prompt caching (system + tools). Anthropic only |
| `--context-size` | int | Context-window override in tokens — drives the auto-compression threshold for **all** providers (also passed to the ollama client) |
| `--compact-ratio` | float | Auto-compression trigger ratio (0 = upstream default 0.8, clamped ≤ 0.9) |
| `--max-output-tokens` | int | Model output cap per call (default 32768). Too-low caps truncate turns mid-tool-call and mangle the session |
| `--config` | path \| `none` | Config TOML path; `none` skips config files entirely |

#### Reserved flags (parsed, not yet wired)

These are accepted and stored in config but currently have **no effect at
runtime** — they await exported APIs in agentscope-go. Do not rely on them.

<!-- src: internal/assemble/assemble.go ChatModel consumes only APIKey/BaseURL/Model/PromptCaching/ContextSize -->

| Flag | Intended effect |
|---|---|
| `--thinking` | Enable extended thinking / reasoning |
| `--thinking-budget` | Thinking token budget |
| `--effort` | Reasoning effort (`low` \| `medium` \| `high`) |
| `--jail` | Confine file tools to cwd |

### Engine env vars

| Variable | Values | Effect |
|---|---|---|
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DASHSCOPE_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY`, `XAI_API_KEY` | string | Provider credentials; one is required unless `--provider ollama` or `--api-key` |
| `TURNWRIGHT_LOG_LEVEL` | slog level (`debug`, `info`, `warn`, `error`) | Engine log verbosity on stderr (default `warn`) |
| `NO_COLOR` | any value, including empty | TUI renders in mono using terminal default colors |

Boolean `TURNWRIGHT_*` env vars follow the Docker/git tri-value convention:
`1` / `true` / `yes` / `on` (case-insensitive) enable; anything else is off.

<!-- src: internal/config/config.go envTruthy -->

| Variable | Status |
|---|---|
| `TURNWRIGHT_PROMPT_CACHING` | Wired (Anthropic) |
| `TURNWRIGHT_THINKING`, `TURNWRIGHT_THINKING_BUDGET`, `TURNWRIGHT_EFFORT`, `TURNWRIGHT_JAIL` | Reserved — parsed, not yet wired (same as the flags above) |

Note that boolean settings are **or-combined** across flag, TOML and env: once
any layer sets one true, a later layer cannot turn it off. See
[configuration](./configuration.md#precedence-the-real-rules).
