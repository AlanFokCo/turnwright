# LCP protocol reference

**LCP** (Line-delimited Control Protocol) is the seam between the Go engine and
any client — the bundled TUI is just its first consumer. The README's pitch,
"the TUI is replaceable", is literally this protocol.

- **Transport**: JSON-RPC 2.0, one message per line (NDJSON), over the engine's
  stdio
- **Roles**: `turnwright-engine serve` is the server; your client writes
  requests to its stdin and reads responses/notifications from its stdout
- **Version**: `protocolVersion = 2`. Breaking changes bump the constant in
  `internal/lcp` and `tui/packages/core/src/protocol.ts` together (v2:
  conversation kernel — `turn/start` queues during a live turn instead of
  erroring, `turn/cancel` interrupts with input retention, new
  `session/compact`)

**stdout is the protocol channel.** The engine writes nothing else there —
logs go to stderr (`TURNWRIGHT_LOG_LEVEL` controls verbosity).

## Lifecycle

```
client                                engine (serve)
  │ ── initialize ──────────────────────▶ │
  │ ◀── {protocolVersion, version, brand, │
  │      provider, model, cwd,            │
  │      capabilities} ──────────────────  │
  │ ── session/new ─────────────────────▶ │
  │ ◀── {sessionId} ─────────────────────  │
  │ ── turn/start {sessionId, input} ───▶ │
  │ ◀── {started: true, queued: bool} ───  │
  │ ◀── agent/event (notification) ──────  │  ×N (streaming)
  │ ◀── approval/request (server→client) ─  │  (only when a tool needs confirmation)
  │ ── response {confirmResults} ────────▶ │
  │ ◀── agent/event … reply_end ─────────  │
```

`capabilities` is a map of booleans — `approval`, `sessions`, `modelSet`,
`streaming`, `thinking`, `steering`, `interrupt`, `compact` — currently all
hardcoded `true` in `initialize`. Per-model thinking support is a different
thing: it is exposed as the `thinking` field on `model/list` cards.

Turns run on an agentscope-go **Conversation kernel**: one persistent event
stream per session, input steerable mid-turn, interruptible, compactable. A
second `turn/start` during a live turn is never an error — it queues.

## Client → server methods

Params use camelCase (`sessionId`, `input`). All results are JSON objects.

<!-- src: internal/lcp/server.go handleRequest -->

| Method | Params | Result |
|---|---|---|
| `initialize` | — | `{protocolVersion, version, brand, provider, model, cwd, capabilities}` |
| `session/new` | — | `{sessionId}` |
| `session/resume` | `{sessionId}` | `{sessionId, resumed: true}` |
| `session/continue` | — | `{sessionId, resumed: true}` (newest session) |
| `session/list` | — | `{sessions: [{session_id, agent_name?, summary?}]}` |
| `session/delete` | `{sessionId}` | `{deleted: <id>}` |
| `session/close` | `{sessionId}` | `{closed: true}` |
| `turn/start` | `{sessionId, input}` | `{started: true, queued: bool}` — a fresh turn streams as `agent/event` notifications; input submitted **during** a running turn is queued (`queued: true`) and steered into it at the next safe boundary (never splitting a tool_call/tool_result pair) |
| `turn/cancel` | `{sessionId}` | `{cancelled: bool}` — interrupts the running turn: in-flight tool processes are killed, pending input is retained for the next turn, and the model sees an interruption marker |
| `session/compact` | `{sessionId}` | `{compacted: true}` — forced context compression; queued behind a running turn's safe boundary, immediate between turns |
| `session/user_shell` | `{sessionId, command, timeoutMs?}` | `{commandId}` — runs a **user-typed** shell command outside the model loop (codex `!` parity): output streams as `user_shell_output` custom events, `user_shell_end` carries exit code + duration. Bypasses the permission engine by design (the user approved by typing it) and never enters model context. Never route model-generated commands here |
| `model/set` | `{sessionId, model}` | `{model}` — rebuilds the session's agent; later sessions inherit the switch |
| `model/list` | — | `{models: [{name, provider, contextSize?, thinking?}], provider, current}` |
| `session/set_permission` | `{sessionId, mode}` | `{permission: mode}` — mode ∈ `default` \| `accept_edits` \| `explore` \| `bypass` \| `dont_ask` |
| `config/get` | — | `{provider, model, permission, maxIters, cwd, brand}` |

Unknown methods return a JSON-RPC error (`method not found`); malformed or
missing required params return `invalid params`.

Requests are handled **concurrently** — responses are not guaranteed to arrive
in request order. Always correlate by `id` (the reference `EngineClient` does
exactly this).

## Server → client

### `elicitation/request` (server request)

An MCP server asking the user for input mid tool call (codex
`Op::ResolveElicitation` parity; only when the session's MCP servers were
connected with an elicitation-capable transport):

```json
{"jsonrpc":"2.0","id":"el-1","method":"elicitation/request","params":{
  "session_id":"…","message":"Which branch?","requested_schema":{…}}}
```

The client answers with a result: `{"action":"accept"|"decline"|"cancel",
"content":{…}}` — `content` carries the submitted form data and is sent to
the server only on accept. While the request is open, other calls on the
same stdio MCP server queue behind it.

### `agent/event` (notification)

Every agentscope-go event, forwarded 1:1 as its JSON representation plus two
injected fields:

- `"type"` — the event type (e.g. `text_block_delta`, `tool_call_start`,
  `reply_end`; full table in [print mode](./print-mode.md#--output-stream-json))
- `"session_id"` — the session the event belongs to

```json
{"jsonrpc":"2.0","method":"agent/event","params":{"type":"text_block_delta","session_id":"…","reply_id":"…","block_id":"…","delta":"Hello"}}
```

The event payload schema is owned by **agentscope-go**; the TypeScript mirror
`AgentEvent` in `tui/packages/core/src/protocol.ts` documents the fields the
official TUI consumes (deltas, tool-call lifecycle, token counts,
`finished_reason`, `error`). Stream/assembly failures arrive as
`{"type":"error","session_id":"…","message":"…"}`.

Custom events (`type: "custom"`, `name` + `value`) the official TUI renders:

| name | meaning |
|---|---|
| `plan_updated` | the model's `update_plan` step plan (live plan panel) |
| `turn_stats` | per-reply totals: `model_calls`, `tool_calls`, `iterations`, `input_tokens`, `output_tokens`, cache tokens, `last_input_tokens`, `duration_ms` — authoritative, emitted right after the terminal `reply_end` |
| `user_shell_start` / `user_shell_output` / `user_shell_end` | a `!` command's lifecycle (command, streamed output, exit code + duration) |
| `conversation_input_injected` | queued input steered into a running turn |
| `conversation_turn_interrupted` | a turn was interrupted (ESC / ctrl+c) |
| `compacted` | a context compression was applied |
| `context_overflow_recovery` | an oversized context was recovered (tool results truncated, summary forced) |

### `approval/request` (request — you must answer)

When a tool call needs confirmation under the current permission mode, the
server sends a **request** (id like `srv-1`) whose params are the
`require_user_confirm` event payload plus `session_id`:

```json
{"jsonrpc":"2.0","id":"srv-1","method":"approval/request",
 "params":{"session_id":"…","reply_id":"…","tool_calls":[
   {"type":"…","id":"…","name":"bash","input":"{…}","state":"…",
    "suggested_rules":[…]}]}}
```

The agent blocks until the client replies with a **result** — one entry per
tool call:

```json
{"jsonrpc":"2.0","id":"srv-1","result":{"confirmResults":[
  {"confirmed":true,"tool_call":{…the original block…},"rules":[…suggested_rules to persist…]}]}}
```

- `confirmed: false` denies the call
- Including `rules` (the call's `suggested_rules`) makes the allow permanent
  for the session — this is what the TUI's `a` ("always") key sends
- Omitting `rules` confirms once

Print mode never sends `approval/request` — it denies such calls immediately.

## Minimal client smoke test

`serve` runs the normal config resolution first, so it needs credentials (or
`--provider ollama`, which needs none), and it exits as soon as stdin reaches
EOF — keep it open briefly so the concurrent handlers can flush their replies:

```sh
(printf '%s\n' \
   '{"jsonrpc":"2.0","id":1,"method":"initialize"}' \
   '{"jsonrpc":"2.0","id":2,"method":"config/get"}'; sleep 2) \
| turnwright-engine serve --provider ollama --model qwen3-max --config none \
| head -2
```

Two JSON-RPC result lines come back (possibly not in request order — match by
`id`). This exact command was run against the engine; a bare
`printf … | turnwright-engine serve` without credentials or the `sleep` prints
nothing.

For a real client, the reference implementation is small:
`tui/packages/core/src/client.ts` (`EngineClient`) spawns the engine, frames
NDJSON, correlates request ids, and routes `agent/event` /
`approval/request`. The Go side lives in `internal/lcp/server.go`.
