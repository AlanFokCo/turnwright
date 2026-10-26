// Package assemble is turnwright's entire job: wiring agentscope-go capabilities
// (model, toolkit, permissions, skills, MCP, session state) into a running
// agent. turnwright implements no agent capability of its own.
package assemble

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	as "github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/agent"
	asconfig "github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/config"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/logging"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/mcp"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/mcp/streamablehttp"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/model"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/permission"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/skill"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/tool"

	"github.com/alanfokco/turnwright/internal/config"
	"github.com/alanfokco/turnwright/internal/transcript"
)

func init() {
	// NOTE: as.Init() is intentionally NOT called — its "initialized:" line
	// goes through a package-private logger hardwired to os.Stdout, which
	// would corrupt LCP framing (stdout is the protocol channel). turnwright only
	// needs the slog plumbing, which logging.Init sets up on its own.
	level := slog.LevelWarn
	if v := os.Getenv("TURNWRIGHT_LOG_LEVEL"); v != "" {
		_ = level.UnmarshalText([]byte(v))
	}
	logging.Init(logging.WithWriter(os.Stderr), logging.WithLevel(level))
}

// Handle bundles the assembled agent with the resources turnwright wired into it.
type Handle struct {
	Agent     *agent.UnifiedAgent
	SessionID string
	Saver     *transcript.Saver
	// PCtx is the live permission context shared with the agent; mutating its
	// Mode changes permission behavior for subsequent tool calls.
	PCtx *permission.Context
	// Elicit routes MCP elicitation requests (servers asking the user for
	// input mid tool call) to the host UI. Set by the LCP server; nil (or
	// print mode) declines — see loadMCP.
	Elicit  func(mcp.ElicitRequest) (mcp.ElicitResponse, error)
	closers []func() error
}

// Close releases MCP subprocesses etc. Safe to call multiple times.
func (h *Handle) Close() {
	for _, c := range h.closers {
		_ = c()
	}
	h.closers = nil
}

// ChatModel builds the provider chat model from resolved config.
func ChatModel(cfg *config.Config) (model.ChatModel, error) {
	switch cfg.Provider {
	case "anthropic":
		return model.NewAnthropicChatModel(&model.AnthropicConfig{
			APIKey:          cfg.APIKey,
			BaseURL:         cfg.BaseURL,
			Model:           cfg.Model,
			PromptCaching:   cfg.PromptCaching,
			MaxOutputTokens: cfg.MaxOutputTokens,
		})
	case "openai":
		return model.NewOpenAIChatModel(model.OpenAIConfig{APIKey: cfg.APIKey, BaseURL: cfg.BaseURL, Model: cfg.Model})
	case "dashscope":
		return model.NewDashScopeChatModel(model.DashScopeConfig{APIKey: cfg.APIKey, BaseURL: cfg.BaseURL, Model: cfg.Model})
	case "deepseek":
		return model.NewDeepSeekChatModel(model.DeepSeekConfig{APIKey: cfg.APIKey, BaseURL: cfg.BaseURL, Model: cfg.Model})
	case "gemini":
		return model.NewGeminiChatModel(model.GeminiConfig{APIKey: cfg.APIKey, BaseURL: cfg.BaseURL, Model: cfg.Model})
	case "moonshot":
		return model.NewMoonshotChatModel(model.MoonshotConfig{APIKey: cfg.APIKey, BaseURL: cfg.BaseURL, Model: cfg.Model})
	case "kimi":
		// Kimi is Moonshot's product line; the wire protocol is the same.
		return model.NewMoonshotChatModel(model.MoonshotConfig{APIKey: cfg.APIKey, BaseURL: cfg.BaseURL, Model: cfg.Model})
	case "xai":
		return model.NewXAIChatModel(model.XAIConfig{APIKey: cfg.APIKey, BaseURL: cfg.BaseURL, Model: cfg.Model})
	case "ollama":
		return model.NewOllamaChatModel(model.OllamaConfig{BaseURL: cfg.BaseURL, Model: cfg.Model, ContextSize: cfg.ContextSize})
	}
	return nil, fmt.Errorf("unknown provider %q", cfg.Provider)
}

// Agent assembles a UnifiedAgent for one session. sessionID == "" starts a
// fresh session; otherwise the state is restored from the saver.
func Agent(ctx context.Context, cfg *config.Config, cwd, sessionID string) (*Handle, error) {
	cm, err := ChatModelDumped(cfg)
	if err != nil {
		return nil, err
	}
	return AgentWithModel(ctx, cfg, cwd, sessionID, cm)
}

// ChatModelDumped is ChatModel wrapped with the tool_result wire-validity
// splitter (see msgsplit.go) and, when TURNWRIGHT_WIRE_DUMP is set, wire
// capture (see wiredump.go). The splitter sits OUTERmost so the dump records
// exactly what reaches the provider.
func ChatModelDumped(cfg *config.Config) (model.ChatModel, error) {
	cm, err := ChatModel(cfg)
	if err != nil {
		return nil, err
	}
	return maybeSplitToolResults(maybeWireDump(cm)), nil
}

// AgentWithModel is Agent with an explicit chat model — the seam used by
// hermetic tests (agenttest.MockModel) and custom model wrappers.
func AgentWithModel(ctx context.Context, cfg *config.Config, cwd, sessionID string, cm model.ChatModel) (*Handle, error) {

	saver, err := transcript.NewSaver(cwd)
	if err != nil {
		return nil, err
	}

	pc, err := asconfig.LoadProjectConfig(cwd)
	if err != nil {
		return nil, fmt.Errorf("project config: %w", err)
	}

	pctx := permission.NewContext(permission.PermissionMode(cfg.Permission))
	pctx.WorkingDirectories[cwd] = permission.WorkingDirectory{Path: cwd, Source: "session"}
	for _, r := range pc.PermissionRules {
		switch r.Behavior {
		case permission.BehaviorAllow:
			pctx.AllowRules[r.ToolName] = append(pctx.AllowRules[r.ToolName], r)
		case permission.BehaviorDeny:
			pctx.DenyRules[r.ToolName] = append(pctx.DenyRules[r.ToolName], r)
		case permission.BehaviorAsk:
			pctx.AskRules[r.ToolName] = append(pctx.AskRules[r.ToolName], r)
		}
	}

	tk := tool.NewEnhancedToolkit()
	h := &Handle{PCtx: pctx}

	// Persistent shell sessions (codex unified_exec parity): one long-lived
	// POSIX shell whose cwd/env survive across tool calls. NewShellManager
	// fails on non-POSIX hosts; the agent keeps the one-shot Bash tool then.
	if sm, err := tool.NewShellManager(tool.WithShellManagerCwd(cwd)); err != nil {
		fmt.Fprintf(os.Stderr, "turnwright: persistent shell sessions unavailable: %v\n", err)
	} else {
		tk.AddGroup("shell", tool.ShellTool(sm), tool.ShellStdinTool(sm))
		h.closers = append(h.closers, sm.Close)
	}

	// Web tools (codex parity): web_search through a host-injected backend
	// (search_url in config / TURNWRIGHT_SEARCH_URL; unset = not registered),
	// plus the read-only WebFetch. Provider credentials never leave this
	// process — agentscope only receives the SearchFunc.
	if sf := searchFunc(cfg); sf != nil {
		tk.AddGroup("web", tool.NewWebSearchTool(sf), tool.WebFetchTool())
	}

	skills := loadSkills(cwd)
	if len(skills) > 0 {
		tk.AddGroup("skills", skill.NewSkillViewerTool(skills))
	}

	mcpTKs, closers := loadMCP(ctx, cwd, h)
	h.closers = append(h.closers, closers...)
	for _, mtk := range mcpTKs {
		tk = mcp.MergeToolkits(tk, mtk)
	}

	opts := []agent.AgentOption{
		agent.WithToolkit(tk),
		agent.WithPermissionContext(pctx),
		agent.WithReactConfig(agent.ReactConfig{MaxIters: cfg.MaxIters}),
		agent.WithStateSaver(saver),
		// Proxy streams occasionally deliver garbled/truncated tool-call
		// chunks ("incomplete tool arguments"); one retry usually yields a
		// clean call instead of aborting the whole turn in front of the user.
		// StreamIdleTimeout: a silent stream is a transport failure — the
		// proxy sometimes wedges mid-reply; 2 minutes catches that faster
		// than the 5-minute upstream default.
		agent.WithModelConfig(agent.ModelConfig{
			MaxRetries:        3,
			RetryDelay:        2 * time.Second,
			StreamIdleTimeout: 2 * time.Minute,
		}),
		// Without ContextConfig the upstream auto-compression never arms
		// (compressContextWithRatio no-ops on a nil config) — sessions would
		// grow unbounded and get tail-truncated by provider proxies.
		// PrecompressRatio (when configured below TriggerRatio) generates the
		// summary in the background so the hard trigger applies it without a
		// blocking model call.
		agent.WithContextConfig(&agent.ContextConfig{
			TriggerRatio:     cfg.CompactRatio,       // 0 = upstream default 0.8
			PrecompressRatio: cfg.CompactPrecompress, // 0 = off; must be < TriggerRatio
			ContextSize:      cfg.ContextSize,        // 0 = auto-detect (model card / default)
		}),
		agent.WithAgentDrivenCompression(),
		// codex parity: a visible step plan the model maintains itself
		// (checkpointed, survives compression) and a budget probe the model
		// can consult before starting expensive subtasks.
		agent.WithPlanTool(),
		agent.WithContextRemainingTool(),
	}
	if len(skills) > 0 {
		opts = append(opts, agent.WithSkills(skills))
	}
	if sessionID != "" {
		state, err := agent.LoadCheckpoint(ctx, saver, sessionID)
		if err != nil {
			return nil, fmt.Errorf("resume session %s: %w", sessionID, err)
		}
		opts = append(opts, agent.WithState(state))
		h.SessionID = sessionID
	} else {
		h.SessionID = as.GenerateID()
		opts = append(opts, agent.WithState(&agent.AgentState{
			SchemaVersion: agent.StateSchemaVersion,
			SessionID:     h.SessionID,
		}))
	}

	h.Agent = agent.NewUnifiedAgent("turnwright", SystemPrompt(cwd, pc), cm, opts...)

	// Durable learned rules: "always allow" answers persist to the project's
	// .agentscope/settings.local.json and are read back on the next session.
	// Without a store the rule still applies in memory for this session only.
	if h.Agent.PermissionEngine() != nil {
		if rs, err := asconfig.NewSettingsRuleStore(cwd); err == nil {
			h.Agent.PermissionEngine().SetRuleStore(rs)
		} else {
			fmt.Fprintf(os.Stderr, "turnwright: durable rules unavailable: %v\n", err)
		}
	}

	h.Saver = saver
	return h, nil
}

// SystemPrompt composes turnwright's product prompt with project instructions
// (CLAUDE.md / AGENTS.md via agentscope's project config loader).
func SystemPrompt(cwd string, pc *asconfig.ProjectConfig) string {
	var b strings.Builder
	b.WriteString("You are turnwright, a coding agent operating in the user's terminal.\n\n")
	b.WriteString("# Environment\n")
	fmt.Fprintf(&b, "- Working directory: %s\n", cwd)
	fmt.Fprintf(&b, "- Platform: %s/%s\n", runtime.GOOS, runtime.GOARCH)
	fmt.Fprintf(&b, "- Date: %s\n", time.Now().Format("2006-01-02"))
	if gitRoot := findGitRoot(cwd); gitRoot != "" {
		fmt.Fprintf(&b, "- Git repository root: %s\n", gitRoot)
	}
	b.WriteString(`
# How to work
- Solve the root cause, not surface symptoms. Read code before editing it.
- Prefer the apply_patch / edit tools for file changes; use bash for running,
  building, and searching.
- Keep changes minimal and consistent with the codebase's existing style.
- Verify with the project's own build/test commands before declaring done.
- Be concise in replies: what changed, why, and what to check next.

# Operating discipline
- Verify, do not assume: after editing a file, re-read the changed region; after
  resolving merge conflicts, confirm no conflict markers remain and the project
  still builds/tests pass before reporting done.
- Git divergence: inspect first (git status, git log of both sides), pick a
  strategy explicitly (merge or rebase), and never re-run a failing pull blindly.
- If a command fails, read the error and adapt; repeating the same command is not progress.
- Merge conflicts, concretely: run git status --porcelain; for each unmerged
  file read the conflict markers, decide the combined content, replace the
  whole marked region with the edit tool (never commit with markers left),
  git add the file, then finish the merge commit. Afterwards run git
  diff --check and re-read each resolved file before declaring done.
- The Shell tool keeps one persistent session: its working directory and
  exported variables survive across calls. cd once at the start, then run
  commands without repeating the path; prefer Shell for command sequences
  and Bash for one-off commands. Long-running commands return a running
  status: poll them with ShellStdin instead of waiting blindly.
- When stuck, change approach: a different tool, a different command, or
  reading the relevant file again.
`)
	if pc != nil && strings.TrimSpace(pc.Instructions) != "" {
		b.WriteString("\n# Project instructions\n\n")
		b.WriteString(strings.TrimSpace(pc.Instructions))
		b.WriteString("\n")
	}
	return b.String()
}

func findGitRoot(cwd string) string {
	dir := cwd
	for {
		if st, err := os.Stat(filepath.Join(dir, ".git")); err == nil && st.IsDir() {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// loadSkills discovers SKILL.md skills from ~/.turnwright/skills and the project's
// .turnwright/skills (walked cwd → filesystem root), via agentscope's loader.
func loadSkills(cwd string) []skill.Skill {
	var dirs []string
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, ".turnwright", "skills"))
	}
	for dir := cwd; ; dir = filepath.Dir(dir) {
		dirs = append(dirs, filepath.Join(dir, ".turnwright", "skills"))
		if filepath.Dir(dir) == dir {
			break
		}
	}
	var out []skill.Skill
	for _, d := range dirs {
		st, err := os.Stat(d)
		if err != nil || !st.IsDir() {
			continue
		}
		loaded, err := skill.NewLocalSkillLoader(d, true).LoadSkills()
		if err == nil {
			out = append(out, loaded...)
		}
	}
	return out
}

// mcpConfig mirrors the .mcp.json file shape (claude-code convention).
type mcpConfig struct {
	Servers map[string]mcpServer `json:"mcpServers"`
}

type mcpServer struct {
	Type    string            `json:"type"` // "stdio" (default) | "http"
	Command string            `json:"command"`
	Args    []string          `json:"args"`
	Env     map[string]string `json:"env"`
	URL     string            `json:"url"`
}

// loadMCP connects every server declared in ~/.turnwright/mcp.json and the
// project's .mcp.json (project wins on name clash). Failures are logged to
// stderr and skipped — one bad server must not block the session. Elicitation
// requests route through h.Elicit (declined when unset, e.g. print mode).
func loadMCP(ctx context.Context, cwd string, h *Handle) ([]*tool.Toolkit, []func() error) {
	servers := map[string]mcpServer{}
	if home, err := os.UserHomeDir(); err == nil {
		mergeMCPFile(servers, filepath.Join(home, ".turnwright", "mcp.json"))
	}
	mergeMCPFile(servers, filepath.Join(cwd, ".mcp.json"))

	elicit := func(ctx context.Context, req mcp.ElicitRequest) (mcp.ElicitResponse, error) {
		if h == nil || h.Elicit == nil {
			return mcp.ElicitResponse{Action: mcp.ElicitDecline}, nil
		}
		return h.Elicit(req)
	}

	var toolkits []*tool.Toolkit
	var closers []func() error
	for name, srv := range servers {
		if err := mcp.ValidateMCPName(name); err != nil {
			continue
		}
		env := make([]string, 0, len(srv.Env))
		for k, v := range srv.Env {
			env = append(env, k+"="+v)
		}
		var (
			tk  *tool.Toolkit
			err error
		)
		if srv.Type == "http" {
			// Streamable HTTP first (elicitation-capable, spec 2025-03-26+);
			// fall back to the bare-POST client for legacy servers.
			c, cerr := streamablehttp.NewClient(ctx, &streamablehttp.Config{
				BaseURL:            srv.URL,
				ElicitationHandler: elicit,
			})
			if cerr == nil {
				tk, err = mcp.NewMCPToolkit(ctx, c)
				closers = append(closers, c.Close)
			} else {
				var hc *mcp.HttpClient
				hc, err = mcp.NewHttpClient(ctx, &mcp.HttpConfig{URL: srv.URL})
				if err == nil {
					tk, err = mcp.NewMCPToolkit(ctx, hc)
					closers = append(closers, hc.Close)
				}
			}
		} else {
			var c *mcp.StdioClient
			c, err = mcp.NewStdioClient(ctx, &mcp.StdioConfig{
				Command: srv.Command, Args: srv.Args, Env: env, WorkDir: cwd, Stateful: true,
				ElicitationHandler: elicit,
			})
			if err == nil {
				tk, err = mcp.NewMCPToolkit(ctx, c)
				closers = append(closers, c.Close)
			}
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "turnwright: mcp server %q skipped: %v\n", name, err)
			continue
		}
		toolkits = append(toolkits, tk)
	}
	return toolkits, closers
}

func mergeMCPFile(dst map[string]mcpServer, path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			fmt.Fprintf(os.Stderr, "turnwright: mcp config %s: %v\n", path, err)
		}
		return
	}
	var cfg mcpConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		fmt.Fprintf(os.Stderr, "turnwright: mcp config %s: %v\n", path, err)
		return
	}
	for name, srv := range cfg.Servers {
		dst[name] = srv
	}
}
