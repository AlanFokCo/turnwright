package assemble

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/agent"
	agenttest "github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/agenttest"
	asconfig "github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/config"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/event"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/message"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/permission"

	"github.com/alanfokco/turnwright/internal/config"
)

// The Conversation kernel must forward turn_stats (and the terminal event
// order) to hosts — the TUI status bar depends on it.
func TestConversationEmitsTurnStats(t *testing.T) {
	mock := agenttest.NewMockModel(agenttest.Default(agenttest.RespondWithText("done")))
	a := agent.NewUnifiedAgent("tw", "sp", mock)
	conv, err := a.NewConversation(context.Background())
	if err != nil {
		t.Fatalf("NewConversation: %v", err)
	}
	defer conv.Close()
	if err := conv.Submit("hi"); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	sawStats, sawEnd := false, false
	deadline := time.After(10 * time.Second)
	for !(sawStats && sawEnd) {
		select {
		case e := <-conv.Events():
			switch ev := e.(type) {
			case event.CustomEvent:
				if ev.Name == "turn_stats" {
					sawStats = true
				}
			case event.ReplyEndEvent:
				sawEnd = true
			}
		case <-deadline:
			t.Fatalf("turn_stats=%v reply_end=%v — conversation starved", sawStats, sawEnd)
		}
	}
}

// Same as above but through the full turnwright assembly (the LCP server's
// exact path): pins which option, if any, drops turn_stats.
func TestConversationEmitsTurnStatsFullAssembly(t *testing.T) {
	cfg := &config.Config{Provider: "anthropic", Model: "m", APIKey: "k", Permission: "default", MaxIters: 5}
	mock := agenttest.NewMockModel(agenttest.Default(agenttest.RespondWithText("done")))
	h, err := AgentWithModel(context.Background(), cfg, t.TempDir(), "", mock)
	if err != nil {
		t.Fatalf("AgentWithModel: %v", err)
	}
	defer h.Close()
	conv, err := h.Agent.NewConversation(context.Background())
	if err != nil {
		t.Fatalf("NewConversation: %v", err)
	}
	defer conv.Close()
	if err := conv.Submit("hi"); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	sawStats, sawEnd := false, false
	deadline := time.After(10 * time.Second)
	for !(sawStats && sawEnd) {
		select {
		case e := <-conv.Events():
			switch ev := e.(type) {
			case event.CustomEvent:
				if ev.Name == "turn_stats" {
					sawStats = true
				}
			case event.ReplyEndEvent:
				sawEnd = true
			}
		case <-deadline:
			t.Fatalf("turn_stats=%v reply_end=%v — conversation starved (full assembly)", sawStats, sawEnd)
		}
	}
}

// A tool round with an interactive approval must still end with turn_stats:
// the LCP server's status-bar numbers depend on it (reproduces the exact
// LCP test mock sequence).
func TestConversationTurnStatsSurvivesApprovalRound(t *testing.T) {
	cfg := &config.Config{Provider: "anthropic", Model: "m", APIKey: "k", Permission: "default", MaxIters: 5}
	mock := agenttest.NewMockModel(
		agenttest.OnNthCall(1, agenttest.RespondWithToolCall("update_plan", map[string]any{
			"plan": []map[string]any{{"step": "s1", "status": "in_progress"}},
		})),
		agenttest.Default(agenttest.RespondWithText("done")),
	)
	h, err := AgentWithModel(context.Background(), cfg, t.TempDir(), "", mock)
	if err != nil {
		t.Fatalf("AgentWithModel: %v", err)
	}
	defer h.Close()
	conv, err := h.Agent.NewConversation(context.Background())
	if err != nil {
		t.Fatalf("NewConversation: %v", err)
	}
	defer conv.Close()
	if err := conv.Submit("plan it"); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	sawStats, sawEnd, sawConfirm := false, false, false
	deadline := time.After(10 * time.Second)
	for !(sawStats && sawEnd) {
		select {
		case e := <-conv.Events():
			switch ev := e.(type) {
			case event.CustomEvent:
				if ev.Name == "turn_stats" {
					sawStats = true
				}
			case event.ReplyEndEvent:
				sawEnd = true
			case event.RequireUserConfirmEvent:
				sawConfirm = true
				h.Agent.SubmitUserConfirm(&event.UserConfirmResultEvent{
					ReplyID:        ev.ReplyID,
					ConfirmResults: []event.ConfirmResult{{Confirmed: true, ToolCall: ev.ToolCalls[0]}},
				})
			}
		case <-deadline:
			t.Fatalf("turn_stats=%v reply_end=%v confirm=%v — starved after approval round", sawStats, sawEnd, sawConfirm)
		}
	}
	if !sawConfirm {
		t.Fatal("expected an approval round in this scenario")
	}
}

// Async-approval variant: the approval is answered from a goroutine while
// the event stream drains concurrently (the LCP server's exact shape).
func TestConversationTurnStatsAsyncApproval(t *testing.T) {
	t.Setenv("HOME", t.TempDir()) // match the LCP test env exactly
	cfg := &config.Config{Provider: "anthropic", Model: "m", APIKey: "k", Permission: "default", MaxIters: 5}
	mock := agenttest.NewMockModel(
		agenttest.OnNthCall(1, agenttest.RespondWithToolCall("update_plan", map[string]any{
			"plan": []map[string]any{{"step": "s1", "status": "in_progress"}},
		})),
		agenttest.Default(agenttest.RespondWithText("done")),
	)
	h, err := AgentWithModel(context.Background(), cfg, t.TempDir(), "", mock)
	if err != nil {
		t.Fatalf("AgentWithModel: %v", err)
	}
	defer h.Close()
	conv, err := h.Agent.NewConversation(context.Background())
	if err != nil {
		t.Fatalf("NewConversation: %v", err)
	}
	defer conv.Close()
	if err := conv.Submit("plan it"); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	var sawStats, sawEnd atomic.Bool
	go func() {
		for e := range conv.Events() {
			switch ev := e.(type) {
			case event.CustomEvent:
				if ev.Name == "turn_stats" {
					sawStats.Store(true)
				}
			case event.ReplyEndEvent:
				sawEnd.Store(true)
			case event.RequireUserConfirmEvent:
				// async answer, like the LCP server's requestApproval goroutine
				go h.Agent.SubmitUserConfirm(&event.UserConfirmResultEvent{
					ReplyID:        ev.ReplyID,
					ConfirmResults: []event.ConfirmResult{{Confirmed: true, ToolCall: ev.ToolCalls[0]}},
				})
			}
		}
	}()
	deadline := time.After(8 * time.Second)
	for !sawStats.Load() || !sawEnd.Load() {
		select {
		case <-deadline:
			t.Fatalf("stats=%v end=%v — turn_stats lost on the async-approval path", sawStats.Load(), sawEnd.Load())
		case <-time.After(10 * time.Millisecond):
		}
	}
}

// "Always allow" rules persist to .agentscope/settings.local.json and are
// read back by the next session's LoadProjectConfig (durable rules).
func TestLearnedRulesPersistAcrossSessions(t *testing.T) {
	dir := t.TempDir()
	cfg := &config.Config{Provider: "anthropic", Model: "m", APIKey: "k"}
	mock := agenttest.NewMockModel(agenttest.Default(agenttest.RespondWithText("done")))
	h, err := AgentWithModel(context.Background(), cfg, dir, "", mock)
	if err != nil {
		t.Fatalf("AgentWithModel: %v", err)
	}
	eng := h.Agent.PermissionEngine()
	if eng == nil {
		t.Fatal("no permission engine")
	}
	if err := eng.AddRulePersistent(permission.Rule{
		ToolName:    "Bash",
		RuleContent: "git status:*",
		Behavior:    permission.BehaviorAllow,
	}); err != nil {
		t.Fatalf("AddRulePersistent: %v", err)
	}
	h.Close()

	// A fresh assembly in the same project reads the rule back.
	pc, err := asconfig.LoadProjectConfig(dir)
	if err != nil {
		t.Fatalf("LoadProjectConfig: %v", err)
	}
	found := false
	for _, r := range pc.PermissionRules {
		if r.ToolName == "Bash" && r.RuleContent == "git status:*" && r.Behavior == permission.BehaviorAllow {
			found = true
		}
	}
	if !found {
		t.Fatalf("learned rule not read back: %+v", pc.PermissionRules)
	}
}

// The wire-validity splitter: a merged assistant message carrying
// tool_result blocks must reach the provider as an assistant message with
// the tool_use(s), followed by a USER message carrying the tool_result(s).
// Proven against the real HTTP request body (not the formatter's output).
func TestToolResultsOnWireInUserMessages(t *testing.T) {
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		_ = json.Unmarshal(body, &captured)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "msg_1", "type": "message", "role": "assistant",
			"content":     []map[string]any{{"type": "text", "text": "ok"}},
			"model":       "m",
			"stop_reason": "end_turn",
			"usage":       map[string]any{"input_tokens": 1, "output_tokens": 1},
		})
	}))
	defer srv.Close()

	cfg := &config.Config{Provider: "anthropic", Model: "m", APIKey: "k", BaseURL: srv.URL}
	cm, err := ChatModelDumped(cfg)
	if err != nil {
		t.Fatalf("ChatModelDumped: %v", err)
	}
	msgs := []*message.Msg{
		{Role: message.RoleUser, Content: []message.ContentBlock{message.TextBlock{Type: "text", Text: "run git status"}}},
		{Role: message.RoleAssistant, Content: []message.ContentBlock{
			message.TextBlock{Type: "text", Text: "running"},
			message.ToolCallBlock{Type: "tool_call", ID: "toolu_1", Name: "Bash", Input: `{"command":"git status"}`, State: message.ToolCallPending},
			message.ToolResultBlock{Type: "tool_result", ID: "toolu_1", Name: "Bash", Output: "on branch main", State: message.ToolResultSuccess},
		}},
	}
	if _, err := cm.Chat(context.Background(), msgs); err != nil {
		t.Fatalf("Chat: %v", err)
	}

	wireMsgs, _ := captured["messages"].([]any)
	if len(wireMsgs) < 3 {
		t.Fatalf("wire messages = %d, want >= 3 (user, assistant, user): %v", len(wireMsgs), captured["messages"])
	}
	var sawAssistantToolUse, sawUserToolResult bool
	for _, wm := range wireMsgs {
		m, _ := wm.(map[string]any)
		role, _ := m["role"].(string)
		content, _ := m["content"].([]any)
		for _, cb := range content {
			b, _ := cb.(map[string]any)
			switch b["type"] {
			case "tool_use":
				if role == "assistant" {
					sawAssistantToolUse = true
				}
			case "tool_result":
				if role == "user" {
					sawUserToolResult = true
				} else {
					t.Fatalf("tool_result in %q message — must be user: %v", role, b)
				}
			}
		}
	}
	if !sawAssistantToolUse || !sawUserToolResult {
		t.Fatalf("assistant tool_use=%v user tool_result=%v", sawAssistantToolUse, sawUserToolResult)
	}
}

// The upstream Anthropic default output cap (1024) truncates coding-agent
// turns mid-tool_use; turnwright must put its configured cap on the wire.
func TestAnthropicMaxOutputTokensOnWire(t *testing.T) {
	var got int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			MaxTokens int `json:"max_tokens"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		got = body.MaxTokens
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "msg_1", "type": "message", "role": "assistant",
			"content":     []map[string]any{{"type": "text", "text": "hi"}},
			"model":       "m",
			"stop_reason": "end_turn",
			"usage":       map[string]any{"input_tokens": 1, "output_tokens": 1},
		})
	}))
	defer srv.Close()

	cfg := &config.Config{
		Provider: "anthropic", Model: "m", APIKey: "k",
		BaseURL: srv.URL, MaxOutputTokens: 8192,
	}
	cm, err := ChatModel(cfg)
	if err != nil {
		t.Fatalf("ChatModel: %v", err)
	}
	msg := &message.Msg{
		Role:    message.RoleUser,
		Content: []message.ContentBlock{message.TextBlock{Text: "hello"}},
	}
	if _, err := cm.Chat(context.Background(), []*message.Msg{msg}); err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if got != 8192 {
		t.Fatalf("wire max_tokens = %d, want 8192", got)
	}
}

// web_search is host-injected: registered only when a search backend is
// configured, and the SearchFunc hits that backend (SearXNG-style JSON).
// Credentials never leave the turnwright process.
func TestWebSearchToolGatingAndBackend(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("q") != "turnwright" || r.URL.Query().Get("format") != "json" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"results": []map[string]any{{"title": "turnwright", "url": "https://example.com", "content": "a lathe for code"}},
		})
	}))
	defer srv.Close()

	cfg := &config.Config{
		Provider: "anthropic", Model: "m", APIKey: "k", Permission: "bypass", MaxIters: 5,
		SearchURL: srv.URL, SearchAPIKey: "sk-test",
	}
	// Round 1: tool call to web_search (registered), then the model reads the result.
	mock := agenttest.NewMockModel(
		agenttest.OnNthCall(1, agenttest.RespondWithToolCall("web_search", map[string]any{"query": "turnwright"})),
		agenttest.Default(agenttest.RespondWithText("done")),
	)
	h, err := AgentWithModel(context.Background(), cfg, t.TempDir(), "", mock)
	if err != nil {
		t.Fatalf("AgentWithModel: %v", err)
	}
	defer h.Close()
	if _, err := h.Agent.Reply(context.Background(), "search for turnwright"); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	sawHit := false
	for _, c := range mock.Calls() {
		for _, m := range c.Messages {
			for _, b := range m.Content {
				if tr, ok := b.(message.ToolResultBlock); ok && strings.Contains(tr.GetOutputText(), "https://example.com") {
					sawHit = true
				}
			}
		}
	}
	if !sawHit {
		t.Fatal("web_search results never reached the model context")
	}

	// Round 2: without a backend the tool is not registered — the call errors.
	mock2 := agenttest.NewMockModel(
		agenttest.OnNthCall(1, agenttest.RespondWithToolCall("web_search", map[string]any{"query": "x"})),
		agenttest.Default(agenttest.RespondWithText("done")),
	)
	cfg2 := *cfg
	cfg2.SearchURL = ""
	cfg2.SearchAPIKey = ""
	h2, err := AgentWithModel(context.Background(), &cfg2, t.TempDir(), "", mock2)
	if err != nil {
		t.Fatalf("AgentWithModel: %v", err)
	}
	defer h2.Close()
	// The reply completes; the unregistered tool surfaces as an error tool
	// result the model can see and adapt to (harness behavior, not a crash).
	if _, err := h2.Agent.Reply(context.Background(), "search"); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	sawErr := false
	for _, c := range mock2.Calls() {
		for _, m := range c.Messages {
			for _, b := range m.Content {
				if tr, ok := b.(message.ToolResultBlock); ok && tr.State == message.ToolResultError && strings.Contains(tr.GetOutputText(), "web_search") {
					sawErr = true
				}
			}
		}
	}
	if !sawErr {
		t.Fatal("unregistered web_search should error back to the model")
	}
}

// The plan tool must be registered (codex parity): a model-driven update_plan
// executes and emits plan_updated; the plan persists in the agent state.
func TestPlanToolRegistered(t *testing.T) {
	cfg := &config.Config{Provider: "anthropic", Model: "m", APIKey: "k", Permission: "bypass", MaxIters: 5}
	mock := agenttest.NewMockModel(
		agenttest.OnNthCall(1, agenttest.RespondWithToolCall("update_plan", map[string]any{
			"plan": []map[string]any{{"step": "resolve conflict", "status": "in_progress"}},
		})),
		agenttest.Default(agenttest.RespondWithText("planned")),
	)
	h, err := AgentWithModel(context.Background(), cfg, t.TempDir(), "", mock)
	if err != nil {
		t.Fatalf("AgentWithModel: %v", err)
	}
	defer h.Close()
	if _, err := h.Agent.Reply(context.Background(), "make a plan"); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	var sawPlan bool
	for _, c := range mock.Calls() {
		for _, m := range c.Messages {
			if txt := m.GetTextContent("\n"); txt != nil && strings.Contains(*txt, "resolve conflict") {
				sawPlan = true
			}
		}
	}
	if !sawPlan {
		t.Fatal("update_plan result never reached the model context")
	}
}

// The persistent shell session keeps its working directory across tool calls
// (codex unified_exec parity) — cd once, subsequent calls inherit it.
func TestShellSessionKeepsCwd(t *testing.T) {
	cfg := &config.Config{Provider: "anthropic", Model: "m", APIKey: "k", Permission: "bypass", MaxIters: 5}
	dir := t.TempDir()
	mock := agenttest.NewMockModel(
		agenttest.OnNthCall(1, agenttest.RespondWithToolCall("Shell", map[string]any{"command": "cd " + dir})),
		agenttest.OnNthCall(2, agenttest.RespondWithToolCall("Shell", map[string]any{"command": "pwd"})),
		agenttest.Default(agenttest.RespondWithText("done")),
	)
	h, err := AgentWithModel(context.Background(), cfg, dir, "", mock)
	if err != nil {
		t.Fatalf("AgentWithModel: %v", err)
	}
	defer h.Close()
	if _, err := h.Agent.Reply(context.Background(), "cd then pwd"); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	sawCwd := false
	for _, c := range mock.Calls() {
		for _, m := range c.Messages {
			for _, b := range m.Content {
				if tr, ok := b.(message.ToolResultBlock); ok && strings.Contains(tr.GetOutputText(), dir) {
					sawCwd = true
				}
			}
		}
	}
	if !sawCwd {
		t.Fatal("Shell session did not keep its working directory across calls")
	}
}
