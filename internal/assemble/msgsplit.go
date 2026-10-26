package assemble

import (
	"context"

	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/message"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/model"
)

// splitToolResultsModel normalizes agent messages before they reach a
// provider chat model: agentscope merges a whole tool round into ONE
// assistant message (thinking, text, tool_use and tool_result blocks
// interleaved), and the Anthropic formatter emits that message verbatim —
// tool_result blocks inside an ASSISTANT wire message. The Anthropic
// Messages API only accepts tool_result blocks in USER messages: strict
// endpoints reject the request, and lenient anthropic-compatible proxies
// accept it while never surfacing the results to the model, which then
// honestly reports "tool output came back empty" and starts confabulating
// (observed with qwen3.8-max behind an anthropic-compatible gateway).
//
// The splitter walks each merged assistant message's blocks in order and
// breaks it into: the message's own blocks (assistant) and the tool_result
// blocks as a follow-up message with the tool role — which every formatter
// maps to a user message. Order is preserved, so every tool_result lands
// after its tool_use. This is a pure call-input transformation: the agent's
// persisted state is untouched.
type splitToolResultsModel struct {
	inner model.ChatModel
}

func maybeSplitToolResults(cm model.ChatModel) model.ChatModel {
	if cm == nil {
		return cm
	}
	return &splitToolResultsModel{inner: cm}
}

func (w *splitToolResultsModel) Chat(ctx context.Context, msgs []*message.Msg, opts ...model.CallOption) (*model.ChatResponse, error) {
	return w.inner.Chat(ctx, SplitMergedToolResults(msgs), opts...)
}

func (w *splitToolResultsModel) ChatStream(ctx context.Context, msgs []*message.Msg, opts ...model.CallOption) (<-chan model.ChatResponse, error) {
	return w.inner.ChatStream(ctx, SplitMergedToolResults(msgs), opts...)
}

func (w *splitToolResultsModel) CountTokens(msgs []*message.Msg, tools []model.ToolSchema) int {
	return w.inner.CountTokens(SplitMergedToolResults(msgs), tools)
}

// SplitMergedToolResults rewrites the message list so no assistant message
// carries tool_result blocks. Messages without tool results pass through
// unchanged; a merged round becomes ordered [assistant(...), tool(results),
// assistant(...), tool(results)] pairs.
func SplitMergedToolResults(msgs []*message.Msg) []*message.Msg {
	needSplit := false
	for _, m := range msgs {
		if m == nil || m.Role != message.RoleAssistant {
			continue
		}
		for _, b := range m.Content {
			if _, ok := b.(message.ToolResultBlock); ok {
				needSplit = true
				break
			}
		}
	}
	if !needSplit {
		return msgs
	}

	out := make([]*message.Msg, 0, len(msgs)+4)
	for _, m := range msgs {
		if m == nil || m.Role != message.RoleAssistant {
			out = append(out, m)
			continue
		}
		var (
			assistantBlocks []message.ContentBlock
			toolBlocks      []message.ContentBlock
			sawResult       bool
		)
		flush := func() {
			if len(assistantBlocks) > 0 {
				a := *m
				a.Content = assistantBlocks
				out = append(out, &a)
				assistantBlocks = nil
			}
			if len(toolBlocks) > 0 {
				t := *m
				t.Role = message.Role("tool") // formatters map the tool role to a user wire message
				t.Content = toolBlocks
				out = append(out, &t)
				toolBlocks = nil
			}
		}
		for _, b := range m.Content {
			if _, ok := b.(message.ToolResultBlock); ok {
				sawResult = true
				if len(assistantBlocks) > 0 {
					// Results follow their calls: close the assistant part
					// before collecting results.
					flush()
				}
				toolBlocks = append(toolBlocks, b)
				continue
			}
			if sawResult && len(toolBlocks) > 0 {
				// New assistant content after results: close the result part.
				flush()
				sawResult = false
			}
			assistantBlocks = append(assistantBlocks, b)
		}
		flush()
	}
	return out
}
