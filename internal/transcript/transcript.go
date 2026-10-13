// Package transcript persists agentscope agent state to disk. It implements
// agent.StateSaver with claude-code-style per-project directories:
// ~/.turnwright/projects/<enc-cwd>/<session-id>.json
package transcript

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/agent"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/message"
)

// Saver is a file-backed agent.StateSaver.
type Saver struct {
	dir string // ~/.turnwright/projects/<enc-cwd>
}

// NewSaver returns a Saver rooted at the per-project directory for cwd.
func NewSaver(cwd string) (*Saver, error) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return nil, fmt.Errorf("transcript: cannot resolve home dir")
	}
	return &Saver{dir: filepath.Join(home, ".turnwright", "projects", EncodeCwd(cwd))}, nil
}

// EncodeCwd maps a working directory to its project-dir slug
// ("/Users/a/repo" → "-Users-a-repo"), matching claude-code's convention.
func EncodeCwd(cwd string) string {
	r := strings.NewReplacer(string(filepath.Separator), "-", " ", "-")
	return r.Replace(cwd)
}

func (s *Saver) path(sessionID string) string {
	return filepath.Join(s.dir, sessionID+".json")
}

// SaveState writes the agent state atomically (tmp file + rename).
func (s *Saver) SaveState(_ context.Context, sessionID string, state *agent.AgentState) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.dir, ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), s.path(sessionID))
}

// LoadState reads a previously saved agent state.
func (s *Saver) LoadState(_ context.Context, sessionID string) (*agent.AgentState, error) {
	data, err := os.ReadFile(s.path(sessionID))
	if err != nil {
		return nil, err
	}
	var state agent.AgentState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("transcript %s: %w", sessionID, err)
	}
	if state.SchemaVersion != agent.StateSchemaVersion {
		return nil, fmt.Errorf("transcript %s: schema version %d, want %d", sessionID, state.SchemaVersion, agent.StateSchemaVersion)
	}
	return &state, nil
}

// ListSessions returns saved session IDs, newest first (by file mtime).
func (s *Saver) ListSessions(_ context.Context) ([]agent.SessionInfo, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	type item struct {
		info  agent.SessionInfo
		mtime int64
	}
	var items []item
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".json") || strings.HasPrefix(name, ".") {
			continue
		}
		st, err := e.Info()
		if err != nil {
			continue
		}
		id := strings.TrimSuffix(name, ".json")
		it := item{info: agent.SessionInfo{SessionID: id}, mtime: st.ModTime().UnixNano()}
		// Best-effort summary: first user text in the transcript.
		if data, err := os.ReadFile(filepath.Join(s.dir, name)); err == nil {
			var state agent.AgentState
			if json.Unmarshal(data, &state) == nil {
				it.info.AgentName = "turnwright"
				it.info.Summary = firstUserText(state.Context)
			}
		}
		items = append(items, it)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].mtime > items[j].mtime })
	out := make([]agent.SessionInfo, len(items))
	for i, it := range items {
		out[i] = it.info
	}
	return out, nil
}

// DeleteSession removes a saved session. Missing sessions are not an error.
func (s *Saver) DeleteSession(_ context.Context, sessionID string) error {
	err := os.Remove(s.path(sessionID))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

// NewestSessionID returns the most recently modified session in dir, or "".
func (s *Saver) NewestSessionID(ctx context.Context) (string, error) {
	infos, err := s.ListSessions(ctx)
	if err != nil || len(infos) == 0 {
		return "", err
	}
	return infos[0].SessionID, nil
}

func firstUserText(msgs []*message.Msg) string {
	for _, m := range msgs {
		if m == nil || m.Role != message.RoleUser {
			continue
		}
		for _, b := range m.Content {
			if tb, ok := b.(message.TextBlock); ok && tb.Text != "" {
				t := strings.TrimSpace(tb.Text)
				if len(t) > 120 {
					t = t[:120] + "…"
				}
				return t
			}
		}
	}
	return ""
}
