package config

import (
	"os"
	"path/filepath"
	"testing"
)

func load(t *testing.T, f Flags) *Config {
	t.Helper()
	f.ConfigPath = "none"
	cfg, err := Load(f)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	return cfg
}

func TestMaxOutputTokensDefault(t *testing.T) {
	cfg := load(t, Flags{Provider: "ollama", Model: "m"})
	if cfg.MaxOutputTokens != 32768 {
		t.Fatalf("default MaxOutputTokens = %d, want 32768", cfg.MaxOutputTokens)
	}
}

func TestMaxOutputTokensFlag(t *testing.T) {
	cfg := load(t, Flags{Provider: "ollama", Model: "m", MaxOutputTokens: 8192})
	if cfg.MaxOutputTokens != 8192 {
		t.Fatalf("MaxOutputTokens = %d, want 8192", cfg.MaxOutputTokens)
	}
}

func TestMaxOutputTokensNegativeClampsToDefault(t *testing.T) {
	cfg := load(t, Flags{Provider: "ollama", Model: "m", MaxOutputTokens: -5})
	if cfg.MaxOutputTokens != 32768 {
		t.Fatalf("MaxOutputTokens = %d, want default 32768", cfg.MaxOutputTokens)
	}
}

func TestCompactRatioClampsToUpstreamTriggerMax(t *testing.T) {
	// upstream ContextConfig caps TriggerRatio at 0.9
	cfg := load(t, Flags{Provider: "ollama", Model: "m", CompactRatio: 0.95})
	if cfg.CompactRatio != 0.9 {
		t.Fatalf("CompactRatio = %v, want clamped 0.9", cfg.CompactRatio)
	}
}

func TestMaxOutputTokensFromTOML(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte("max_output_tokens = 4096\ncompact_ratio = 0.5\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(Flags{Provider: "ollama", Model: "m", ConfigPath: path})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.MaxOutputTokens != 4096 {
		t.Fatalf("MaxOutputTokens = %d, want 4096 from TOML", cfg.MaxOutputTokens)
	}
	if cfg.CompactRatio != 0.5 {
		t.Fatalf("CompactRatio = %v, want 0.5 from TOML", cfg.CompactRatio)
	}
}
