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
