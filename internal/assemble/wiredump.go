package assemble

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/formatter"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/message"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/model"
)

// wireDumpModel wraps a ChatModel and records, for every call, the exact
// wire-format messages (as the provider formatter serializes them) and the
// assembled final response. Enabled by TURNWRIGHT_WIRE_DUMP=<dir>; failures
// to dump never affect the wrapped model. This is the debugging instrument
// for provider/proxy interoperability ("model says tool output is empty"
// vs. what actually went on the wire).
type wireDumpModel struct {
	inner model.ChatModel
	dir   string
	mu    sync.Mutex
	n     int
}

func maybeWireDump(cm model.ChatModel) model.ChatModel {
	dir := os.Getenv("TURNWRIGHT_WIRE_DUMP")
	if dir == "" {
		return cm
	}
	return &wireDumpModel{inner: cm, dir: dir}
}

func (w *wireDumpModel) next() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.n++
	return filepath.Join(w.dir, fmt.Sprintf("call-%03d", w.n))
}

// dumpRequest serializes msgs with the Anthropic formatter — the same code
// path AnthropicChatModel uses — so the dump IS what the proxy receives
// (modulo provider-specific request fields like max_tokens).
func (w *wireDumpModel) dumpRequest(tag string, msgs []*message.Msg, opts []model.CallOption) {
	name := w.next()
	_ = os.MkdirAll(w.dir, 0o700)
	f := formatter.NewAnthropicFormatter()
	formatted, err := f.Format(msgs)
	if err != nil {
		_ = os.WriteFile(name+"-format-error.txt", []byte(err.Error()), 0o600)
		return
	}
	// CallOptions carry the tool list; include what we can extract.
	callOpts := &model.CallOptions{}
	for _, o := range opts {
		o(callOpts)
	}
	dump := map[string]any{"messages": formatted, "tools": callOpts.Tools}
	if len(callOpts.Tools) == 0 {
		delete(dump, "tools")
	}
	data, err := json.MarshalIndent(dump, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(name+"-req.json", data, 0o600)
}

func (w *wireDumpModel) dumpResponse(tag string, resp *model.ChatResponse, err error) {
	name := w.next()
	_ = os.MkdirAll(w.dir, 0o700)
	var data []byte
	if err != nil {
		data, _ = json.MarshalIndent(map[string]any{"error": err.Error()}, "", "  ")
	} else if resp != nil {
		data, _ = json.MarshalIndent(resp, "", "  ")
	} else {
		data = []byte(`{"error": "nil response"}`)
	}
	_ = os.WriteFile(name+"-resp.json", data, 0o600)
}

func (w *wireDumpModel) Chat(ctx context.Context, msgs []*message.Msg, opts ...model.CallOption) (*model.ChatResponse, error) {
	w.dumpRequest("chat", msgs, opts)
	resp, err := w.inner.Chat(ctx, msgs, opts...)
	w.dumpResponse("chat", resp, err)
	return resp, err
}

func (w *wireDumpModel) ChatStream(ctx context.Context, msgs []*message.Msg, opts ...model.CallOption) (<-chan model.ChatResponse, error) {
	w.dumpRequest("stream", msgs, opts)
	ch, err := w.inner.ChatStream(ctx, msgs, opts...)
	if err != nil {
		w.dumpResponse("stream", nil, err)
		return ch, err
	}
	out := make(chan model.ChatResponse, 16)
	go func() {
		defer close(out)
		var final *model.ChatResponse
		for resp := range ch {
			if resp.IsLast {
				cp := resp
				final = &cp
			}
			out <- resp
		}
		w.dumpResponse("stream", final, nil)
	}()
	return out, nil
}

func (w *wireDumpModel) CountTokens(msgs []*message.Msg, tools []model.ToolSchema) int {
	return w.inner.CountTokens(msgs, tools)
}
