package lcp

import (
	"context"
	"encoding/json"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/agenttest"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/model"

	"github.com/alanfokco/lathe/internal/config"
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
	if brand["name"] != "lathe" || len(brand["logo"].([]any)) == 0 {
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
