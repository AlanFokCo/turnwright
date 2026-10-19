package assemble

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/message"

	"github.com/alanfokco/turnwright/internal/config"
)

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
			"content":    []map[string]any{{"type": "text", "text": "hi"}},
			"model":      "m",
			"stop_reason": "end_turn",
			"usage":      map[string]any{"input_tokens": 1, "output_tokens": 1},
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
