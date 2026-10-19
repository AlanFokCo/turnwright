// turnwright-engine is the Go engine binary of turnwright. It is an assembly layer over
// agentscope-go: `serve` speaks LCP (JSON-RPC 2.0 over stdio) for the
// TypeScript TUI; `-p` runs a non-interactive print turn.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/alanfokco/turnwright/internal/config"
	"github.com/alanfokco/turnwright/internal/lcp"
	"github.com/alanfokco/turnwright/internal/printmode"
)

var version = config.Version

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	err := newRootCmd().ExecuteContext(ctx)
	if err == nil {
		return
	}
	var ee exitError
	if errors.As(err, &ee) {
		os.Exit(int(ee)) // printmode already reported the cause
	}
	fmt.Fprintln(os.Stderr, "turnwright:", err)
	os.Exit(1)
}

func newRootCmd() *cobra.Command {
	var f config.Flags

	root := &cobra.Command{
		Use:           "turnwright-engine",
		SilenceErrors: true,
		SilenceUsage:  true,
		Short: "turnwright engine — a coding agent assembled on agentscope-go",
		Version: version,
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load(f)
			if err != nil {
				return err
			}
			cwd, _ := os.Getwd()
			if cfg.Prompt == "" {
				return fmt.Errorf("no prompt: pass -p/--prompt, or use `turnwright-engine serve` with the TypeScript TUI (npm i -g @turnwright/cli)")
			}
			if code := printmode.Run(cmd.Context(), cfg, cwd); code != 0 {
				return exitError(code)
			}
			return nil
		},
	}

	serve := &cobra.Command{
		Use:   "serve",
		Short: "run the LCP stdio server for the TypeScript TUI",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load(f)
			if err != nil {
				return err
			}
			cwd, _ := os.Getwd()
			return lcp.NewServer(cfg, cwd, os.Stdin, os.Stdout).Serve(cmd.Context())
		},
	}
	root.AddCommand(serve)

	p := root.PersistentFlags()
	p.StringVarP(&f.Prompt, "prompt", "p", "", "non-interactive prompt (print mode)")
	p.StringVar(&f.Provider, "provider", "", "anthropic|openai|dashscope|deepseek|gemini|moonshot|kimi|xai|ollama")
	p.StringVar(&f.Model, "model", "", "model name (provider default when empty)")
	p.StringVar(&f.APIKey, "api-key", "", "API key (env vars preferred)")
	p.StringVar(&f.BaseURL, "base-url", "", "provider base URL override")
	p.StringVar(&f.Permission, "permission", "", "default|accept_edits|explore|bypass|dont_ask")
	p.StringVar(&f.Output, "output", "", "text|stream-json")
	p.IntVar(&f.MaxIters, "max-iters", 0, "max agent loop iterations")
	p.StringVar(&f.Resume, "resume", "", "resume session by id")
	p.BoolVar(&f.Continue, "continue", false, "continue newest session in this project")
	p.BoolVar(&f.Thinking, "thinking", false, "enable extended thinking")
	p.IntVar(&f.ThinkingBudget, "thinking-budget", 0, "thinking token budget")
	p.StringVar(&f.Effort, "effort", "", "reasoning effort: low|medium|high")
	p.BoolVar(&f.Jail, "jail", false, "confine file tools to cwd")
	p.BoolVar(&f.PromptCaching, "prompt-caching", false, "Anthropic prompt caching")
	p.Float64Var(&f.CompactRatio, "compact-ratio", 0, "reserved: auto-compact ratio (pending agentscope-go export)")
	p.IntVar(&f.ContextSize, "context-size", 0, "context window override in tokens (drives auto-compression threshold)")
	p.IntVar(&f.MaxOutputTokens, "max-output-tokens", 0, "model output cap per call (default 32768)")
	p.StringVar(&f.ConfigPath, "config", "", "config TOML path (\"none\" skips)")
	return root
}

type exitError int

func (e exitError) Error() string { return fmt.Sprintf("exit %d", int(e)) }
