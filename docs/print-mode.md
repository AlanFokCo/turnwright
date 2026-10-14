# Print mode (non-interactive)

`turnwright-engine -p "…"` runs a single agent turn without the TUI and streams
the result to stdout — the scripting and CI surface of turnwright.

## Getting the engine binary

Print mode is the **engine** binary, not the `turnwright` launcher. The npm
install does *not* put `turnwright-engine` on your `PATH` (the per-platform
engine packages ship no `bin` link — the TUI resolves the binary inside
`node_modules` itself). Get it either way:

```sh
# from a source checkout
go build -o turnwright-engine ./cmd/turnwright-engine

# or from the npm-installed platform package (a path, not on PATH).
# package = @turnwright/engine-<os>-<arch>, os ∈ darwin|linux, arch ∈ x64|arm64:
"$(npm root -g)/@turnwright/engine-darwin-arm64/bin/turnwright-engine"  # Apple Silicon
```

<!-- src: scripts/build-dist.sh (engine package.json has no bin field); tui/packages/cli/bin/turnwright.js resolveEngine -->

The rest of this page writes `turnwright-engine` assuming it resolves on your
`PATH` (source builds) — substitute the full path otherwise.

## Read this first: approvals are auto-denied

Print mode has no user to answer approval dialogs. **Any tool call that would
require confirmation is denied outright**, with
`turnwright: denied (non-interactive): <tool>` on stderr; the agent sees the
denial and adapts.

<!-- src: internal/printmode/print.go (package doc + RequireUserConfirmEvent branch) -->

Choose a permission mode deliberately for unattended runs:

| Mode | CI behavior |
|---|---|
| `accept_edits` (default) | Reads + edits inside cwd auto-allowed; anything else (e.g. shell commands) is **denied** — the agent works with one hand tied |
| `dont_ask` | Everything that would ask is denied, predictably; pair with project `allow` rules for exactly the tools you permit |
| `bypass` | Everything allowed, never asks — **only inside a sandbox/disposable container** |
| `explore` | Read-only; writes denied. Good for analysis/audit jobs |

Permission modes: [TUI guide](./tui-guide.md#permission-modes).

## Usage

```sh
turnwright-engine -p "explain this repo"                     # text output
turnwright-engine -p "list TODOs" --output stream-json       # NDJSON events
turnwright-engine -p "…" --provider openai --model gpt-4o-mini
turnwright-engine -p "…" --config none                       # ignore ~/.turnwright/config.toml
```

Running the engine with **no** `-p` exits with an error pointing at `serve`
and the npm package — print mode requires a prompt.

## Output formats

### `--output text` (default)

Text deltas stream to stdout as they arrive; a final newline is printed when
the reply ends. Warnings (denials, skipped MCP servers) go to stderr.

### `--output stream-json`

One JSON object per line (NDJSON): the raw agentscope-go event with two fields
injected — `"type"` (the event type) and `"session_id"`.

<!-- src: internal/eventjson/eventjson.go Marshal + internal/printmode/print.go -->

Event types the official TUI renders (the upstream stream may include others):

| `type` | Meaning / key fields |
|---|---|
| `reply_start` | Turn begins (`reply_id`) |
| `text_block_start`, `text_block_delta` | Assistant text (`delta`) |
| `thinking_block_delta` | Reasoning text (`delta`) |
| `tool_call_start`, `tool_call_delta`, `tool_call_end` | Tool call lifecycle (`tool_call_id`, `tool_call_name`, `tool_call_input`, `state`) |
| `tool_result_text_delta`, `tool_result_end` | Tool output |
| `tool_policy_denied` | A permission rule blocked the call |
| `require_user_confirm` | Would-be approval prompt (auto-denied here) (`tool_calls`) |
| `model_call_end` | One model round-trip done (`input_tokens`, `output_tokens`, cache token fields) |
| `reply_end` | Turn finished (`finished_reason`, `error` when failed) |
| `exceed_max_iters` | `max_iters` hit before completion |
| `error` | Stream/assembly error (`message`) |

<!-- src: tui/packages/tui/src/store.ts reduce — field names per tui/packages/core/src/protocol.ts AgentEvent -->

The event schema is owned by **agentscope-go**, not turnwright; the TypeScript
mirror in `tui/packages/core/src/protocol.ts` (`AgentEvent`) is the most
convenient field reference.

## Exit codes

<!-- src: internal/printmode/print.go Run + cmd/turnwright-engine/main.go -->

| Code | Meaning |
|---|---|
| `0` | Turn completed |
| `1` | Config/assembly/stream error, or `reply_end` carried an error (message on stderr) |

Denied tool calls do **not** affect the exit code — check the stream for
`tool_policy_denied` / `require_user_confirm` if your pipeline cares.

## Sessions in print mode

Print-mode turns are checkpointed to the same per-project store the TUI uses
(`~/.turnwright/projects/<enc-cwd>/`), so a scripted turn can be continued
interactively later:

```sh
turnwright-engine -p "start a migration plan" --output stream-json | tee run.ndjson
turnwright --continue          # later, in the TUI
```

- `--resume <id>` resumes an exact session; `--continue` takes the newest one
  in this project (`--resume` wins if both are passed)
- Each line of `stream-json` output carries `session_id` for correlation

## CI example

```yaml
- name: Audit dependencies
  run: |
    turnwright-engine \
      -p "list dependencies with known CVEs; output JSON array only" \
      --permission explore \
      --output stream-json \
      --config none \
    | jq -r 'select(.type == "text_block_delta") | .delta' > audit.txt
```

Notes:

- `--permission explore` guarantees read-only; nothing can be denied mid-audit
- `--config none` keeps the run independent of any host-level config
- Extract assistant text by filtering `text_block_delta` events (`jq` above)
- Pin provider/model explicitly (`--provider`/`--model`) for reproducibility
