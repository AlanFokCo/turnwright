package transcript

import (
	"context"
	"testing"

	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/agent"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/message"
)

func TestSaverRoundtrip(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	s, err := NewSaver("/tmp/some/project")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	state := &agent.AgentState{
		SchemaVersion: agent.StateSchemaVersion,
		SessionID:     "s-1",
		Context: []*message.Msg{
			{Role: message.RoleUser, Content: []message.ContentBlock{message.TextBlock{Text: "hello"}}},
		},
	}
	if err := s.SaveState(ctx, "s-1", state); err != nil {
		t.Fatal(err)
	}
	loaded, err := s.LoadState(ctx, "s-1")
	if err != nil {
		t.Fatal(err)
	}
	if loaded.SessionID != "s-1" || len(loaded.Context) != 1 {
		t.Fatalf("roundtrip mismatch: %+v", loaded)
	}

	infos, err := s.ListSessions(ctx)
	if err != nil || len(infos) != 1 {
		t.Fatalf("list: %v %v", infos, err)
	}
	if infos[0].Summary != "hello" {
		t.Fatalf("summary = %q", infos[0].Summary)
	}

	if err := s.DeleteSession(ctx, "s-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.LoadState(ctx, "s-1"); err == nil {
		t.Fatal("expected error loading deleted session")
	}
}

func TestEncodeCwd(t *testing.T) {
	if got := EncodeCwd("/Users/a/my repo"); got != "-Users-a-my-repo" {
		t.Fatalf("EncodeCwd = %q", got)
	}
}
