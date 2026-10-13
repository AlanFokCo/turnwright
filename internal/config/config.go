// Package config resolves turnwright's runtime configuration: provider, model,
// API key, permission mode, output format. Resolution order:
// flag > env > TOML (~/.turnwright/config.toml) > defaults.
//
// turnwright v2: this package is pure assembly glue — all agent capability
// (turn loop, permissions, compression, sessions) lives in agentscope-go.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/credential"
)

// Version is the turnwright version surfaced in --version and LCP initialize.
// Release builds override it via -ldflags "-X .../config.Version=x.y.z".
var Version = "2.0.0-dev"

// Output is the print-mode output format.
type Output string

const (
	OutputText       Output = "text"
	OutputStreamJSON Output = "stream-json"
)

// Brand is the product identity surfaced by the TUI (welcome hero, status
// line, terminal title). Forks rebrand turnwright by editing config only.
type Brand struct {
	Name    string   `toml:"name" json:"name"`
	Tagline string   `toml:"tagline" json:"tagline"`
	Accent  string   `toml:"accent" json:"accent"` // hex color, e.g. "#F59E0B"
	Logo    []string `toml:"logo" json:"logo"`   // ASCII art, one string per line
	Theme   string   `toml:"theme" json:"theme"` // default theme name
	// Status orders the status-line slots; empty = default layout.
	// Known slots: busy, model, branch, permission, tokens, toks, session.
	Status []string `toml:"status" json:"status,omitempty"`
}

// DefaultBrand is turnwright's own visual identity.
func DefaultBrand() Brand {
	return Brand{
		Name:    "turnwright",
	Tagline: "shape your code at the lathe",
		Accent:  "#F59E0B",
		Logo: []string{
		"┌┬┐ ┬ ┬",
		" │  │││",
		" ┴  └┴┘",
		},
		Theme: "turnwright-dark",
	}
}

// Config is the resolved runtime configuration.
type Config struct {
	Provider   string // anthropic | openai | dashscope | deepseek | gemini | moonshot | kimi | xai | ollama
	Model      string
	APIKey     string
	BaseURL    string
	Permission string // default | accept_edits | explore | bypass | dont_ask
	Output     Output
	MaxIters   int
	Prompt     string
	Resume     string
	Continue   bool
	Thinking       bool   // enable extended thinking / reasoning
	ThinkingBudget int    // thinking token budget (0 = provider default)
	ReasoningEffort string // "low"|"medium"|"high"; "" = provider default
	Jail           bool   // confine file tools to cwd
	PromptCaching  bool   // Anthropic prompt caching (system + tools)
	CompactRatio   float64 // fraction of context triggering auto-compact (0 = default)
	ContextSize    int     // model context window override in tokens (0 = model card)
	Brand          Brand
}

// Flags holds CLI overrides; empty fields are unset.
type Flags struct {
	ConfigPath                                         string // "" = DefaultTOMLPath(); "none" = skip
	Provider, Model, APIKey, BaseURL, Permission       string
	Output, Prompt                                     string
	MaxIters                                           int
	Resume                                             string
	Continue                                           bool
	Thinking                                           bool
	ThinkingBudget                                     int
	Effort                                             string
	Jail                                               bool
	PromptCaching                                      bool
	CompactRatio                                       float64
	ContextSize                                        int
}

// Load resolves a Config from flags + env + TOML + defaults.
func Load(f Flags) (*Config, error) {
	tomlPath := f.ConfigPath
	if tomlPath == "" {
		tomlPath = DefaultTOMLPath()
	}
	var t TOMLFile
	if tomlPath != "none" && tomlPath != "/dev/null" {
		var terr error
		if t, terr = LoadTOML(tomlPath); terr != nil {
			return nil, terr
		}
		f = mergeTOMLIntoFlags(f, t)
	}
	cfg := &Config{
		Brand:      DefaultBrand(),
		Permission: "accept_edits",
		Output:     OutputText,
		MaxIters:   50,
		Prompt:     f.Prompt,
		Resume:     f.Resume,
		Continue:   f.Continue,
	}
	if f.Permission != "" {
		cfg.Permission = f.Permission
	}
	if f.Output != "" {
		cfg.Output = Output(f.Output)
	}
	if f.MaxIters > 0 {
		cfg.MaxIters = f.MaxIters
	}
	cfg.Thinking = f.Thinking
	cfg.ThinkingBudget = f.ThinkingBudget
	if !cfg.Thinking && envTruthy(os.Getenv("TURNWRIGHT_THINKING")) {
		cfg.Thinking = true
	}
	if cfg.Thinking && cfg.ThinkingBudget == 0 {
		if e := os.Getenv("TURNWRIGHT_THINKING_BUDGET"); e != "" {
			if n, err := strconv.Atoi(e); err == nil && n > 0 {
				cfg.ThinkingBudget = n
			}
		}
		if cfg.ThinkingBudget == 0 {
			cfg.ThinkingBudget = 4096
		}
	}
	cfg.ReasoningEffort = f.Effort
	if cfg.ReasoningEffort == "" {
		cfg.ReasoningEffort = os.Getenv("TURNWRIGHT_EFFORT")
	}
	cfg.Jail = f.Jail
	if !cfg.Jail && envTruthy(os.Getenv("TURNWRIGHT_JAIL")) {
		cfg.Jail = true
	}
	cfg.PromptCaching = f.PromptCaching
	if !cfg.PromptCaching && envTruthy(os.Getenv("TURNWRIGHT_PROMPT_CACHING")) {
		cfg.PromptCaching = true
	}
	cfg.CompactRatio = f.CompactRatio
	if cfg.CompactRatio < 0 {
		cfg.CompactRatio = 0
	}
	if cfg.CompactRatio > 0.95 {
		cfg.CompactRatio = 0.95
	}
	cfg.ContextSize = f.ContextSize
	if t.Brand.Name != "" {
		cfg.Brand.Name = t.Brand.Name
	}
	if t.Brand.Tagline != "" {
		cfg.Brand.Tagline = t.Brand.Tagline
	}
	if t.Brand.Accent != "" {
		cfg.Brand.Accent = t.Brand.Accent
	}
	if len(t.Brand.Logo) > 0 {
		cfg.Brand.Logo = t.Brand.Logo
	}
	if t.Brand.Theme != "" {
		cfg.Brand.Theme = t.Brand.Theme
	}

	if f.Provider != "" {
		cfg.Provider = f.Provider
		cfg.BaseURL = f.BaseURL
		cfg.APIKey = f.APIKey
		if cfg.APIKey == "" {
			if cred := credential.FromEnvForProvider(f.Provider); cred != nil {
				cfg.APIKey = cred.APIKey()
				if cfg.BaseURL == "" {
					cfg.BaseURL = cred.BaseURL()
				}
			}
		}
		cfg.Model = pickDefaultModel(cfg.Provider, f.Model)
	} else {
		cred := credential.FromEnv()
		if cred == nil {
			return nil, fmt.Errorf("no API key: set ANTHROPIC_API_KEY / OPENAI_API_KEY / DASHSCOPE_API_KEY / GEMINI_API_KEY / DEEPSEEK_API_KEY / MOONSHOT_API_KEY / XAI_API_KEY or pass --provider/--api-key")
		}
		cfg.Provider = cred.Provider()
		cfg.APIKey = cred.APIKey()
		cfg.BaseURL = cred.BaseURL()
		cfg.Model = pickDefaultModel(cfg.Provider, f.Model)
	}
	// Ollama needs no key; default base URL to the standard local port.
	if cfg.Provider == "ollama" {
		if cfg.BaseURL == "" {
			cfg.BaseURL = "http://localhost:11434"
		}
		if cfg.APIKey == "" {
			cfg.APIKey = "ollama"
		}
	}
	if cfg.APIKey == "" {
		return nil, fmt.Errorf("no API key for provider %q", cfg.Provider)
	}
	return cfg, nil
}

func pickDefaultModel(provider, override string) string {
	if override != "" {
		return override
	}
	switch provider {
	case "anthropic":
		return "claude-sonnet-4-5"
	case "openai":
		return "gpt-4o-mini"
	case "dashscope":
		return "qwen-plus"
	case "deepseek":
		return "deepseek-chat"
	case "gemini":
		return "gemini-2.5-flash"
	case "moonshot", "kimi":
		return "kimi-k2.7-code"
	case "xai":
		return "grok-4-fast"
	}
	return override
}

// envTruthy follows the Docker/git tri-value convention: "1"/"true"/"yes"/"on"
// enable, everything else (including empty) is off.
func envTruthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}
