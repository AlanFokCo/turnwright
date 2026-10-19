# TUI guide

The interactive client: chat stream on top, input box below, status line at the
bottom (brand · vim indicator · busy · model · branch · permission · tokens ·
tok/s · session).

## Keys

<!-- src: tui/packages/tui/src/App.tsx onInputKeyDown / useKeyboard -->

| Key | Action |
|---|---|
| `enter` | Send the input (ignored while a turn is running or input is empty) |
| `shift+enter`, `ctrl+j` | Newline (`shift+enter` only on terminals that report it) |
| `up` / `down` | Prompt history — walks from the first/last line of the buffer |
| `tab` | Accept the first completion candidate (slash commands at line start, `@paths` at a trailing `@`) |
| `pageup` / `pagedown` | Scroll the transcript ±20 lines |
| `ctrl+c` | While busy: cancel the current turn. While idle: quit |
| `y` / `n` / `a` | Approval dialog: allow once / deny / always |
| `↑` `↓` `enter` `esc` | List pickers (sessions, model, theme): move / select / cancel |

Input is a multi-line textarea; long prompts wrap normally.

## Slash commands

Commands are TUI-local — they never reach the model. `tab` completes them at
the start of a line.

<!-- src: tui/packages/tui/src/slash.ts SLASH_COMMANDS + App.tsx handleSlash -->

| Command | Effect |
|---|---|
| `/help` | List all commands |
| `/model [name]` | Switch model. No argument opens a picker of the provider's model cards (context size, thinking support); a typed name switches immediately and applies to future sessions in this process too |
| `/sessions` | Resume a saved session (picker, newest first, id prefix + summary) |
| `/theme [name]` | Switch theme. No argument: picker of the two builtins. A typed name can be **any** theme with a matching override file — see [theming](./theming-and-branding.md) |
| `/permission <mode>` | Set permission mode; no argument prints the current mode and the five options |
| `/status` | Session id, model, permission mode, cwd |
| `/vim [on\|off]` | Toggle vim keybindings (no argument toggles) |
| `/compact` | *Stub* — prints a notice. Manual compaction awaits an upstream agentscope-go API; **automatic compaction is always active** (see below) |
| `/clear` | Clear the conversation **view** only — the agent's context is untouched |
| `/quit` | Exit (alias: `/exit`, not listed in `/help`) |

Unknown commands print a warning; nothing is sent to the model.

## Permission modes

The mode decides what the agent may do without asking. Set at startup
(`--permission` / `permission` in config; default `accept_edits`), changed live
with `/permission <mode>`. This page is the canonical description; the CLI and
config docs link here.

<!-- src: agentscope-go pkg/agentscope/permission/engine.go check* implementations -->

| Mode | Behavior |
|---|---|
| `default` | Everything not covered by rules or the tool's own safety checks **asks** via the approval dialog |
| `accept_edits` | Like `default`, plus read-only operations and edits **inside the working directory** are auto-allowed; anything else still asks. turnwright registers the cwd as a working directory for every session |
| `explore` | Read-only. Non-read-only invocations are **denied outright**; configured `ask` rules still ask. Safe "just look around" mode |
| `bypass` | Everything allowed, never asks. Explicit `deny` and `ask` rules (e.g. from project config) are still honored. Use only where damage is acceptable or contained |
| `dont_ask` | Never asks: anything that would require confirmation is **denied**, and the agent adapts. The right mode for unattended/CI runs paired with allow rules |

All modes share one prefix: project/config **`deny` rules first, then `ask`
rules** — so they keep working even under `bypass`. After that the modes
diverge: `default` and `accept_edits` consult the tool's own safety logic and
your `allow` rules, then fall back to asking; `explore` skips the tool logic
entirely (read-only invocations allowed, everything else denied); `bypass`
turns every remaining ask into an allow — *including* the tool's own safety
asks; `dont_ask` turns them into denials.

<!-- src: agentscope-go pkg/agentscope/permission/engine.go checkDefault/checkExplore/checkAcceptEdits/checkBypass/checkDontAsk -->

### The approval dialog

When a tool call needs confirmation the dialog shows the tool name and input:

- `y` — allow this call once
- `n` — deny this call (the agent sees the denial and adapts)
- `a` — allow **always**: the suggested permission rules attached to the call
  are accepted for the rest of the session, so matching future calls pass
  silently

## `@file` references

Prefix a path with `@` to attach a file's contents to the prompt:

```
> refactor @src/config.ts to use zod, keep @package.json versions
```

<!-- src: tui/packages/tui/src/atfile.ts -->

- Resolved relative to the session cwd
- Must be a regular file ≤ **64 KB**; directories and missing files are
  reported as `@name not found` warnings, oversized ones as
  `@name (>64KB) not found`, and all are skipped
- Each file is attached once (deduplicated) as a `<file path="…">…</file>`
  block appended to your message
- While typing, `tab` completes `@paths`: workspace walk capped at depth 4,
  skipping `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`,
  `__pycache__`, and dot-directories (except `.turnwright`)

## Sessions

Every turn is checkpointed to disk automatically:

```
~/.turnwright/projects/<enc-cwd>/<session-id>.json
```

`<enc-cwd>` is the working directory with `/` and spaces replaced by `-`
(claude-code convention), so each project keeps its own session list.

<!-- src: internal/transcript/transcript.go -->

- `/sessions` lists them newest-first (by file mtime) with a summary — the
  first user message, truncated to 120 characters
- `turnwright --continue` resumes the newest session at startup;
  `turnwright --resume <id>` picks an exact one. Pass both to the launcher and
  the **last one given wins**; in the engine's print mode `--resume` takes
  priority over `--continue`
- Writes are atomic (temp file + rename)
- Transcripts are **schema-versioned**: after an engine upgrade, old sessions
  may be rejected with a `schema version … want …` error. They stay on disk but
  cannot be resumed

If the engine process dies, the TUI shows `engine exited (code N)` — session
state is checkpointed, so restarting turnwright and resuming picks up where it
ended.

## Vim mode

`/vim` (or `/vim on`) switches the input box to vim keybindings; a `NORM`/`INS`
indicator appears in the status line and the cursor becomes a block.

<!-- src: tui/packages/tui/src/App.tsx vimNormalBindings -->

- **insert → normal**: `esc` (kitty/disambiguate terminals) or `ctrl+g`
  (universal)
- **normal → insert**: `i` (in place), `a` (move right one), `I` (line home),
  `A` (line end)
- **normal-mode motions**: `h` `l` `w` `b` `0` `$` `x` and `D`
  (delete-to-line-end). All other keys are swallowed in normal mode
- `/vim off` returns to default bindings

## Auto-compaction

Two compression layers are active:

- **Automatic, token-threshold**: when the transcript passes
  `compact_ratio` (default 0.8) of the context window (`context_size`,
  auto-detected or set in config), older history is summarized and the
  summary persists in the session.
- **Agent-driven**: the agent may compress on its own initiative between
  thresholds.

Manual `/compact` remains a stub pending an upstream export — with the two
automatic layers you don't need it. Long sessions stay inside the window
instead of being tail-truncated by the provider.

## Status line

Slots, left to right (default order): `busy`, `model`, `branch`, `permission`,
`tokens` (↑in ↓out), `toks` (tok/s), `session` (id prefix). Reorder or trim
them with `[brand] status` in config.

<!-- src: tui/packages/tui/src/components.tsx StatusLine -->

On narrow terminals, low-priority slots drop out instead of wrapping:
`permission` needs ≥ 58 columns, `branch` ≥ 68, `tokens` ≥ 76, `toks` ≥ 84,
`session` ≥ 92. Unknown slot names are ignored.
