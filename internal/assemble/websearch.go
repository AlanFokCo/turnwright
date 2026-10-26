package assemble

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/tool"

	"github.com/alanfokco/turnwright/internal/config"
)

// searchFunc builds the host-injected web_search backend from config: a
// JSON-over-HTTP search API (SearXNG-compatible: GET <url>?q=<query>&format=json
// returning {"results":[{title,url,content}]}), with an optional bearer key.
// Provider credentials and ranking stay inside the turnwright process —
// agentscope-go's web_search tool only ever sees the SearchFunc. Returns nil
// when no backend is configured (the tool is then not registered).
func searchFunc(cfg *config.Config) tool.SearchFunc {
	if cfg.SearchURL == "" {
		return nil
	}
	client := &http.Client{Timeout: 20 * time.Second}
	base := strings.TrimRight(cfg.SearchURL, "/")
	return func(ctx context.Context, query string, limit int) ([]tool.SearchResult, error) {
		u := base + "?q=" + url.QueryEscape(query) + "&format=json"
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			return nil, fmt.Errorf("search: %w", err)
		}
		req.Header.Set("Accept", "application/json")
		if cfg.SearchAPIKey != "" {
			req.Header.Set("Authorization", "Bearer "+cfg.SearchAPIKey)
		}
		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("search: %w", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
			return nil, fmt.Errorf("search: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
		}
		var payload struct {
			Results []struct {
				Title   string `json:"title"`
				URL     string `json:"url"`
				Content string `json:"content"`
			} `json:"results"`
		}
		if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
			return nil, fmt.Errorf("search: decode: %w", err)
		}
		out := make([]tool.SearchResult, 0, limit)
		for _, r := range payload.Results {
			if len(out) >= limit {
				break
			}
			if r.URL == "" && r.Title == "" {
				continue
			}
			out = append(out, tool.SearchResult{Title: r.Title, URL: r.URL, Snippet: r.Content})
		}
		if len(out) == 0 {
			return nil, fmt.Errorf("search: no results")
		}
		return out, nil
	}
}
