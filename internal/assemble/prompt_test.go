package assemble

import (
	"strings"
	"testing"
)

// The product prompt must carry the operating discipline that real tasks
// (merge conflicts, verification) kept failing without.
func TestSystemPromptCarriesOperatingDiscipline(t *testing.T) {
	p := SystemPrompt("/tmp", nil)
	for _, want := range []string{
		"conflict markers",
		"never re-run a failing pull",
		"repeating the same command is not progress",
	} {
		if !strings.Contains(p, want) {
			t.Fatalf("SystemPrompt missing discipline %q", want)
		}
	}
}

// The prompt must teach the persistent-shell session semantics (cd once,
// poll with ShellStdin) — without them models re-prefix every command and
// wait blindly on long-running commands.
func TestSystemPromptTeachesPersistentShell(t *testing.T) {
	p := SystemPrompt("/tmp", nil)
	for _, want := range []string{
		"persistent session",
		"cd once",
		"ShellStdin",
		"polling an idle session is an error",
	} {
		if !strings.Contains(p, want) {
			t.Fatalf("SystemPrompt missing shell guidance %q", want)
		}
	}
}

// The prompt must curb the observed failure modes of real sessions:
// runaway reconnaissance before acting, unrequested side artifacts, and
// silent multi-minute tool runs.
func TestSystemPromptCurbsOverExploration(t *testing.T) {
	p := SystemPrompt("/tmp", nil)
	for _, want := range []string{
		"Act on what was asked, immediately",
		"backup branches",
		"Talk while working",
	} {
		if !strings.Contains(p, want) {
			t.Fatalf("SystemPrompt missing discipline %q", want)
		}
	}
}
