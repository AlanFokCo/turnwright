// Package printmode is the non-interactive path: `lathe-engine -p "..."`.
// It drains the agentscope event stream once, rendering text to stdout or
// raw events as NDJSON (--output stream-json). Permission asks are denied
// outright (non-interactive cannot answer) — use --permission to relax.
package printmode

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/event"

	"github.com/alanfokco/lathe/internal/assemble"
	"github.com/alanfokco/lathe/internal/config"
	"github.com/alanfokco/lathe/internal/eventjson"
	"github.com/alanfokco/lathe/internal/transcript"
)

// Run executes one prompt and streams the result. Returns a process exit code.
func Run(ctx context.Context, cfg *config.Config, cwd string) int {
	sessionID := cfg.Resume
	if cfg.Continue && sessionID == "" {
		saver, err := transcript.NewSaver(cwd)
		if err == nil {
			sessionID, _ = saver.NewestSessionID(ctx)
		}
	}
	h, err := assemble.Agent(ctx, cfg, cwd, sessionID)
	if err != nil {
		fmt.Fprintln(os.Stderr, "lathe:", err)
		return 1
	}
	defer h.Close()

	ch, err := h.Agent.ReplyStream(ctx, cfg.Prompt)
	if err != nil {
		fmt.Fprintln(os.Stderr, "lathe:", err)
		return 1
	}

	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	streamJSON := cfg.Output == config.OutputStreamJSON
	exit := 0

	for e := range ch {
		if streamJSON {
			if m, err := eventjson.Marshal(e); err == nil {
				m["session_id"] = h.SessionID
				data, _ := json.Marshal(m)
				fmt.Fprintln(out, string(data))
			}
		}
		switch ev := e.(type) {
		case event.TextBlockDeltaEvent:
			if !streamJSON {
				fmt.Fprint(out, ev.Delta)
				out.Flush()
			}
		case event.RequireUserConfirmEvent:
			denyAll(h, ev)
			if !streamJSON {
				for _, tc := range ev.ToolCalls {
					fmt.Fprintf(os.Stderr, "lathe: denied (non-interactive): %s\n", tc.Name)
				}
			}
		case event.ReplyEndEvent:
			if ev.Error != nil {
				fmt.Fprintln(os.Stderr, "lathe:", ev.Error.Message)
				exit = 1
			}
			if !streamJSON {
				fmt.Fprintln(out)
			}
		}
	}
	return exit
}

func denyAll(h *assemble.Handle, ev event.RequireUserConfirmEvent) {
	results := make([]event.ConfirmResult, len(ev.ToolCalls))
	for i, tc := range ev.ToolCalls {
		results[i] = event.ConfirmResult{Confirmed: false, ToolCall: tc}
	}
	h.Agent.SubmitUserConfirm(&event.UserConfirmResultEvent{
		ReplyID:        ev.ReplyID,
		ConfirmResults: results,
	})
}
