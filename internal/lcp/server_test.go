package lcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/agenttest"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/mcp"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/model"

	"github.com/alanfokco/turnwright/internal/config"
)

// testClient drives an LCP server over in-memory pipes.
type testClient struct {
	t      *testing.T
	srvIn  io.Writer // client -> server
	dec    *json.Decoder
	mu     sync.Mutex
	nextID int
}

func newTestEnv(t *testing.T, mf func(*config.Config) (model.ChatModel, error)) *testClient {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	cfg := &config.Config{
		Provider: "ollama", Model: "fake", APIKey: "fake",
		Permission: "default", MaxIters: 5, Brand: config.DefaultBrand(),
	}
	cliR, srvW := io.Pipe()
	srvR, cliW := io.Pipe()
	srv := NewServerWithModel(cfg, t.TempDir(), srvR, srvW, mf)
	go func() { _ = srv.Serve(context.Background()) }()
	return &testClient{t: t, srvIn: cliW, dec: json.NewDecoder(cliR)}
}

func (c *testClient) call(method string, params any) map[string]any {
	c.t.Helper()
	c.mu.Lock()
	c.nextID++
	id := c.nextID
	c.mu.Unlock()
	c.send(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	return c.waitResponse(id)
}

func (c *testClient) send(m map[string]any) {
	c.t.Helper()
	if err := json.NewEncoder(c.srvIn).Encode(m); err != nil {
		c.t.Fatal(err)
	}
}

// waitResponse reads messages until the response for id arrives. Server
// requests (approval) are answered automatically with a deny-all result.
func (c *testClient) waitResponse(id int) map[string]any {
	c.t.Helper()
	for {
		m := c.recv()
		if rid, ok := m["id"]; ok {
			if f, _ := rid.(float64); f == float64(id) {
				return m
			}
			if s, _ := rid.(string); s != "" && m["method"] == "approval/request" {
				c.answerApproval(s, m)
			}
		}
	}
}

func (c *testClient) answerApproval(id string, m map[string]any) {
	params, _ := m["params"].(map[string]any)
	toolCalls, _ := params["tool_calls"].([]any)
	results := make([]map[string]any, len(toolCalls))
	for i, tc := range toolCalls {
		results[i] = map[string]any{"confirmed": true, "tool_call": tc}
	}
	c.send(map[string]any{
		"jsonrpc": "2.0", "id": id,
		"result": map[string]any{"confirmResults": results},
	})
}

func (c *testClient) recv() map[string]any {
	c.t.Helper()
	var m map[string]any
	if err := c.dec.Decode(&m); err != nil {
		c.t.Fatal(err)
	}
	return m
}

// collectEvents reads notifications until reply_end (or timeout via test).
func (c *testClient) collectEvents() []map[string]any {
	c.t.Helper()
	var out []map[string]any
	for {
		m := c.recv()
		if m["method"] == "agent/event" {
			p, _ := m["params"].(map[string]any)
			out = append(out, p)
			if p["type"] == "reply_end" {
				return out
			}
		} else if m["method"] == "approval/request" {
			if id, _ := m["id"].(string); id != "" {
				c.answerApproval(id, m)
			}
		}
	}
}

func TestInitialize(t *testing.T) {
	c := newTestEnv(t, nil)
	resp := c.call("initialize", nil)
	res := resp["result"].(map[string]any)
	if res["protocolVersion"] != float64(ProtocolVersion) {
		t.Fatalf("protocolVersion = %v", res["protocolVersion"])
	}
	brand := res["brand"].(map[string]any)
	if brand["name"] != "turnwright" || len(brand["logo"].([]any)) == 0 {
		t.Fatalf("brand = %v", brand)
	}
}

func TestTurnStreamsText(t *testing.T) {
	mock := agenttest.NewMockModel(
		agenttest.Default(agenttest.RespondWithText("hello from mock")),
	)
	c := newTestEnv(t, func(*config.Config) (model.ChatModel, error) { return mock, nil })

	sess := c.call("session/new", nil)["result"].(map[string]any)
	sid := sess["sessionId"].(string)
	resp := c.call("turn/start", map[string]any{"sessionId": sid, "input": "hi"})
	if e, ok := resp["error"]; ok {
		t.Fatalf("turn/start error: %v", e)
	}
	events := c.collectEvents()
	var text string
	var sawReplyEnd bool
	for _, e := range events {
		if e["type"] == "text_block_delta" {
			text += e["delta"].(string)
		}
		if e["type"] == "reply_end" {
			sawReplyEnd = true
		}
	}
	if text != "hello from mock" {
		t.Fatalf("text = %q", text)
	}
	if !sawReplyEnd {
		t.Fatal("no reply_end")
	}
	// Close the session so the conversation's post-turn checkpoint and the
	// drain goroutine finish before the TempDir cleanup runs.
	c.call("session/close", map[string]any{"sessionId": sid})
}

func TestApprovalRoundtrip(t *testing.T) {
	mock := agenttest.NewMockModel(
		agenttest.OnNthCall(1, agenttest.RespondWithToolCall("bash", map[string]any{"command": "echo lcp-approval-ok"})),
		agenttest.Default(agenttest.RespondWithText("done")),
	)
	c := newTestEnv(t, func(*config.Config) (model.ChatModel, error) { return mock, nil })

	sess := c.call("session/new", nil)["result"].(map[string]any)
	sid := sess["sessionId"].(string)
	c.call("turn/start", map[string]any{"sessionId": sid, "input": "run echo"})

	// collectEvents auto-approves; bash must actually execute.
	var sawResult bool
	deadline := time.After(15 * time.Second)
	done := make(chan []map[string]any)
	go func() { done <- c.collectEvents() }()
	var events []map[string]any
	select {
	case events = <-done:
	case <-deadline:
		t.Fatal("timed out waiting for reply_end")
	}
	for _, e := range events {
		if e["type"] == "tool_result_start" || e["type"] == "tool_result_end" {
			sawResult = true
		}
		if e["type"] == "require_user_confirm" {
			// good — reached the approval gate
		}
	}
	if !sawResult {
		t.Fatalf("no tool result events; got %v", typesOf(events))
	}
	c.call("session/close", map[string]any{"sessionId": sid})
}

func typesOf(events []map[string]any) []string {
	var out []string
	for _, e := range events {
		out = append(out, e["type"].(string))
	}
	return out
}

func TestSessionResumeMissing(t *testing.T) {
	c := newTestEnv(t, nil)
	resp := c.call("session/resume", map[string]any{"sessionId": "does-not-exist"})
	if resp["error"] == nil {
		t.Fatal("expected error resuming missing session")
	}
}

// waitEvent reads server output until an agent event matches pred. Approval
// requests are auto-answered along the way.
func (c *testClient) waitEvent(pred func(map[string]any) bool) map[string]any {
	c.t.Helper()
	for {
		m := c.recv()
		if m["method"] == "agent/event" {
			p, _ := m["params"].(map[string]any)
			if pred(p) {
				return p
			}
		} else if m["method"] == "approval/request" {
			if id, _ := m["id"].(string); id != "" {
				c.answerApproval(id, m)
			}
		}
	}
}

// Input submitted while a turn runs must be queued (steered into the turn at
// the next safe boundary), never rejected as "session busy". The steered text
// reaches the next model call.
func TestTurnSteeringQueuesInput(t *testing.T) {
	mock := agenttest.NewMockModel(
		agenttest.OnNthCall(1, agenttest.RespondWithToolCall("bash", map[string]any{"command": "sleep 1"})),
		agenttest.Default(agenttest.RespondWithText("done")),
	)
	c := newTestEnv(t, func(*config.Config) (model.ChatModel, error) { return mock, nil })
	sid := c.call("session/new", nil)["result"].(map[string]any)["sessionId"].(string)
	c.call("turn/start", map[string]any{"sessionId": sid, "input": "first"})

	// Wait until bash is actually running (approval answered), then submit
	// mid-turn: the engine must queue it instead of erroring.
	c.waitEvent(func(p map[string]any) bool { return p["type"] == "tool_result_start" })
	resp := c.call("turn/start", map[string]any{"sessionId": sid, "input": "steered message"})
	res := resp["result"].(map[string]any)
	if res["queued"] != true {
		t.Fatalf("turn/start during active turn: queued = %v, want true", res["queued"])
	}

	// The steered input surfaces as an injection event and reaches the model.
	injected := c.waitEvent(func(p map[string]any) bool {
		return p["type"] == "custom" && p["name"] == "conversation_input_injected"
	})
	if injected == nil {
		t.Fatal("no conversation_input_injected event")
	}
	c.waitEvent(func(p map[string]any) bool { return p["type"] == "reply_end" })

	calls := mock.Calls()
	if len(calls) < 2 {
		t.Fatalf("model calls = %d, want >= 2", len(calls))
	}
	sawSteered := false
	for _, m := range calls[1].Messages {
		if txt := m.GetTextContent("\n"); txt != nil && strings.Contains(*txt, "steered message") {
			sawSteered = true
		}
	}
	if !sawSteered {
		t.Fatal("steered input never reached a model call")
	}
	c.call("session/close", map[string]any{"sessionId": sid})
}

// Interrupting a running turn: in-flight tools are killed, the turn still
// emits a terminal reply_end, and the model-visible interruption marker lands
// as a custom event.
func TestTurnInterruptKillsRunningTurn(t *testing.T) {
	mock := agenttest.NewMockModel(
		agenttest.OnNthCall(1, agenttest.RespondWithToolCall("bash", map[string]any{"command": "sleep 30"})),
		agenttest.Default(agenttest.RespondWithText("never reached")),
	)
	c := newTestEnv(t, func(*config.Config) (model.ChatModel, error) { return mock, nil })
	sid := c.call("session/new", nil)["result"].(map[string]any)["sessionId"].(string)
	c.call("turn/start", map[string]any{"sessionId": sid, "input": "run long task"})

	c.waitEvent(func(p map[string]any) bool { return p["type"] == "tool_result_start" })
	resp := c.call("turn/cancel", map[string]any{"sessionId": sid})
	res := resp["result"].(map[string]any)
	if res["cancelled"] != true {
		t.Fatalf("turn/cancel: cancelled = %v, want true", res["cancelled"])
	}

	end := c.waitEvent(func(p map[string]any) bool { return p["type"] == "reply_end" })
	if fr, _ := end["finished_reason"].(string); !strings.Contains(fr, "interrupted") {
		t.Fatalf("reply_end finished_reason = %q, want interrupted", fr)
	}
	c.waitEvent(func(p map[string]any) bool {
		return p["type"] == "custom" && p["name"] == "conversation_turn_interrupted"
	})
	c.call("session/close", map[string]any{"sessionId": sid})
}

// session/compact runs a forced compression between turns.
func TestSessionCompactBetweenTurns(t *testing.T) {
	mock := agenttest.NewMockModel(agenttest.Default(agenttest.RespondWithText("done")))
	c := newTestEnv(t, func(*config.Config) (model.ChatModel, error) { return mock, nil })
	sid := c.call("session/new", nil)["result"].(map[string]any)["sessionId"].(string)
	c.call("turn/start", map[string]any{"sessionId": sid, "input": "hi"})
	c.waitEvent(func(p map[string]any) bool { return p["type"] == "reply_end" })

	resp := c.call("session/compact", map[string]any{"sessionId": sid})
	if resp["error"] != nil {
		t.Fatalf("session/compact error: %v", resp["error"])
	}
	c.call("session/close", map[string]any{"sessionId": sid})
}

// A user shell command (`!` parity) runs outside the model loop: output
// streams as user_shell_* events and the command NEVER enters model context.
func TestUserShellRunsOutsideModelContext(t *testing.T) {
	mock := agenttest.NewMockModel(agenttest.Default(agenttest.RespondWithText("done")))
	c := newTestEnv(t, func(*config.Config) (model.ChatModel, error) { return mock, nil })
	sid := c.call("session/new", nil)["result"].(map[string]any)["sessionId"].(string)

	resp := c.call("session/user_shell", map[string]any{"sessionId": sid, "command": "echo user-shell-ok-42"})
	res := resp["result"].(map[string]any)
	if res["commandId"] == "" || res["commandId"] == nil {
		t.Fatalf("session/user_shell result = %v", res)
	}

	var output, endEv map[string]any
	for output == nil || endEv == nil {
		ev := c.waitEvent(func(p map[string]any) bool {
			return p["type"] == "custom" && (p["name"] == "user_shell_output" || p["name"] == "user_shell_end")
		})
		if ev["name"] == "user_shell_output" {
			output = ev
		} else {
			endEv = ev
		}
	}
	if !strings.Contains(fmt.Sprint(output["value"]), "user-shell-ok-42") {
		t.Fatalf("user_shell_output missing echo output: %v", output["value"])
	}
	v, _ := endEv["value"].(map[string]any)
	if code, _ := v["exit_code"].(float64); code != 0 {
		t.Fatalf("user_shell_end exit_code = %v, want 0", v["exit_code"])
	}

	// The command must never appear in any model call.
	for _, call := range mock.Calls() {
		for _, m := range call.Messages {
			if txt := m.GetTextContent("\n"); txt != nil && strings.Contains(*txt, "user-shell-ok-42") {
				t.Fatal("user shell command leaked into model context")
			}
		}
	}
	c.call("session/close", map[string]any{"sessionId": sid})
}

// plan_updated and turn_stats custom events flow to the client (they power
// the TUI plan panel and the status-line token counts).
func TestPlanAndTurnStatsEventsForwarded(t *testing.T) {
	mock := agenttest.NewMockModel(
		agenttest.OnNthCall(1, agenttest.RespondWithToolCall("update_plan", map[string]any{
			"plan": []map[string]any{{"step": "inspect repo", "status": "in_progress"}},
		})),
		agenttest.Default(agenttest.RespondWithText("done")),
	)
	c := newTestEnv(t, func(*config.Config) (model.ChatModel, error) { return mock, nil })
	sid := c.call("session/new", nil)["result"].(map[string]any)["sessionId"].(string)
	c.call("turn/start", map[string]any{"sessionId": sid, "input": "plan it"})

	// Single reader throughout: plan_updated lands before reply_end,
	// turn_stats right after it (the verdict path emits it once the end
	// event has escaped the chain).
	planEv := c.waitEvent(func(p map[string]any) bool {
		return p["type"] == "custom" && p["name"] == "plan_updated"
	})
	v, _ := planEv["value"].(map[string]any)
	plan, _ := v["plan"].([]any)
	if len(plan) != 1 {
		t.Fatalf("plan_updated plan = %v", v["plan"])
	}
	statsEv := c.waitEvent(func(p map[string]any) bool {
		return p["type"] == "custom" && p["name"] == "turn_stats"
	})
	sv, _ := statsEv["value"].(map[string]any)
	if _, ok := sv["input_tokens"]; !ok {
		t.Fatalf("turn_stats missing input_tokens: %v", sv)
	}
	c.call("session/close", map[string]any{"sessionId": sid})
}

// The MCP elicitation roundtrip: the engine sends elicitation/request, the
// client answers accept/decline, and the handler returns the answer.
func TestElicitationRoundtrip(t *testing.T) {
	// server reads from inR, writes to outW; the test plays the client on
	// the other ends (inW for answers, outR for server-initiated requests).
	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	defer inR.Close()
	defer outR.Close()
	s := NewServer(&config.Config{Provider: "ollama", Model: "fake", APIKey: "fake", Brand: config.DefaultBrand()}, t.TempDir(), inR, outW)
	go func() { _ = s.Serve(context.Background()) }()

	st := &sessionState{}
	sctx, cancel := context.WithCancel(context.Background())
	st.sctx = sctx
	st.cancel = cancel
	handler := s.elicitFor(st, "sess-1")

	type answer struct {
		action  string
		content map[string]any
	}
	got := make(chan answer, 1)
	go func() {
		resp, err := handler(mcp.ElicitRequest{
			Message:         "Which branch?",
			RequestedSchema: json.RawMessage(`{"type":"object","properties":{"branch":{"type":"string"}}}`),
		})
		if err != nil {
			t.Errorf("handler error: %v", err)
		}
		got <- answer{action: resp.Action, content: resp.Content}
	}()

	// Read the elicitation request off the wire and answer it.
	dec := json.NewDecoder(outR)
	var req map[string]any
	if err := dec.Decode(&req); err != nil {
		t.Fatalf("decode elicitation request: %v", err)
	}
	if req["method"] != "elicitation/request" {
		t.Fatalf("method = %v", req["method"])
	}
	params, _ := req["params"].(map[string]any)
	if params["message"] != "Which branch?" {
		t.Fatalf("message = %v", params["message"])
	}
	if _, ok := params["requested_schema"]; !ok {
		t.Fatal("requested_schema missing on the wire")
	}
	if err := json.NewEncoder(inW).Encode(map[string]any{
		"jsonrpc": "2.0", "id": req["id"],
		"result": map[string]any{"action": "accept", "content": map[string]any{"branch": "main"}},
	}); err != nil {
		t.Fatalf("send answer: %v", err)
	}

	select {
	case a := <-got:
		if a.action != "accept" || a.content["branch"] != "main" {
			t.Fatalf("handler answer = %+v", a)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("elicitation handler did not resolve")
	}
	cancel()
	s.closeAll()
	_ = outW.Close()
	_ = inW.Close()
}
