# Skills, MCP & project setup

Three ways to shape the agent for a project, all file-based and all discovered
automatically at session start: **project instructions** (what the agent should
know), **permission rules** (what it may do), **skills** (procedures it can
follow), and **MCP servers** (extra tools).

## Project instructions: CLAUDE.md / AGENTS.md

turnwright reads your project's instruction files (CLAUDE.md, AGENTS.md — via
agentscope-go's project config loader) and injects them into the system prompt
under a `# Project instructions` heading.

<!-- src: internal/assemble/assemble.go SystemPrompt / AgentWithModel (asconfig.LoadProjectConfig) -->

The system prompt the agent actually sees is composed of:

1. Identity ("You are turnwright, a coding agent operating in the user's terminal")
2. Environment: working directory, platform, date, git repository root
3. Working style: read before editing, prefer edit tools over shell for file
   changes, keep changes minimal, verify with the project's own build/test
   commands, be concise
4. Your project instructions, verbatim

The file format and discovery rules are defined upstream in
[agentscope-go](https://github.com/agentscope-ai/agentscope-go) — turnwright
adds nothing of its own here.

The same loader surfaces **project permission rules** (`allow` / `deny` /
`ask`, per tool). They are merged into the session's permission context and
are honored in *every* permission mode — including `bypass`, where `deny` and
`ask` rules still apply. Rule syntax is defined upstream alongside the project
config format.

## Skills

A skill is a directory with a `SKILL.md` file describing a procedure the agent
can load on demand (agentscope-go's skill format). Discovery:

<!-- src: internal/assemble/assemble.go loadSkills -->

| Location | Scope |
|---|---|
| `~/.turnwright/skills/<skill>/SKILL.md` | Global — all your projects |
| `<project>/.turnwright/skills/<skill>/SKILL.md` | Project — checked in, shared with the team |

Project discovery walks **from the cwd up to the filesystem root**, so a
`.turnwright/skills` directory anywhere above the project (e.g. a monorepo
root) applies to every directory below it.

Loaded skills are exposed to the agent through a skill-viewer tool and the
agentscope skills option; malformed skill directories are skipped silently.

## MCP servers

turnwright connects [Model Context Protocol](https://modelcontextprotocol.io)
servers declared in JSON, using the claude-code `.mcp.json` convention:

<!-- src: internal/assemble/assemble.go loadMCP / mcpConfig -->

| File | Scope |
|---|---|
| `~/.turnwright/mcp.json` | Global (note: **no** leading dot in the filename) |
| `<project>/.mcp.json` | Project — checked in; **wins on name clashes** with global |

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": { "SOME_VAR": "value" }
    },
    "internal-api": {
      "type": "http",
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

- `type` defaults to `"stdio"`; `"http"` connects to a URL instead of spawning
  a process
- stdio servers are **stateful** (kept alive for the session) and run with the
  session cwd as working directory; `env` adds environment variables
- Server names are validated; invalid names are skipped
- **A server that fails to start never blocks the session** — the engine
  writes `turnwright: mcp server "name" skipped: …` straight to stderr (not
  gated by `TURNWRIGHT_LOG_LEVEL`). The TUI spawns the engine with inherited
  stderr, so the warning reaches your terminal in both TUI and print mode

Tools from all connected servers are merged into the agent's toolkit alongside
the built-in tools, and pass through the same permission engine
(`allow`/`deny`/`ask` rules apply to MCP tool names like any other).

## Suggested project layout

```
my-project/
├── .mcp.json                 # project MCP servers
├── .turnwright/
│   └── skills/
│       └── release/
│           └── SKILL.md      # project-specific procedure
├── CLAUDE.md                 # or AGENTS.md — project instructions
└── …
```

Everything above is per-project and safe to check in (keep secrets in
`~/.turnwright/mcp.json` `env` values or the environment, not in `.mcp.json`).
