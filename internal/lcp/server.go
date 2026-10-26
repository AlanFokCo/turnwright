// Package lcp implements the Turnwright Core Protocol: JSON-RPC 2.0 over stdio
// (NDJSON framing). The TypeScript TUI spawns `turnwright-engine serve` and drives
// sessions through it. All agent capability is agentscope-go; this package
// only translates between the protocol and the agentscope event stream.
package lcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
	"time"

	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/agent"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/event"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/mcp"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/model"
	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/permission"

	"github.com/alanfokco/turnwright/internal/assemble"
	"github.com/alanfokco/turnwright/internal/config"
	"github.com/alanfokco/turnwright/internal/eventjson"
	"github.com/alanfokco/turnwright/internal/transcript"
)

// ProtocolVersion is negotiated in initialize; bump on breaking changes.
const ProtocolVersion = 2

type wireMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *wireError      `json:"error,omitempty"`
}

type wireError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// sessionState drives one session through an agentscope Conversation kernel:
// turns run on the conversation's persistent event stream, so user input can
// be queued mid-turn (steering) and a running turn can be interrupted.
type sessionState struct {
	h          *assemble.Handle
	conv       *agent.Conversation
	sctx       context.Context    // session lifetime (drain loop, approvals)
	cancel     context.CancelFunc // cancels sctx
	mu         sync.Mutex         // guards turn activity, closed, agent swap
	turnActive bool
	closed     bool
}

// Server is the LCP stdio server.
type Server struct {
	cfg      *config.Config
	cwd      string
	newModel func(*config.Config) (model.ChatModel, error)

	dec *json.Decoder
	enc *json.Encoder
	wmu sync.Mutex

	sessionsMu sync.Mutex
	sessions   map[string]*sessionState

	pendingMu sync.Mutex
	pending   map[string]chan wireMessage
	seq       atomic.Int64
}

// NewServer creates a server reading from r and writing to w.
func NewServer(cfg *config.Config, cwd string, r io.Reader, w io.Writer) *Server {
	return NewServerWithModel(cfg, cwd, r, w, nil)
}

// NewServerWithModel is NewServer with a model factory override — the seam
// hermetic tests use to inject agenttest.MockModel.
func NewServerWithModel(cfg *config.Config, cwd string, r io.Reader, w io.Writer, mf func(*config.Config) (model.ChatModel, error)) *Server {
	if mf == nil {
		mf = assemble.ChatModelDumped // honors TURNWRIGHT_WIRE_DUMP for wire debugging
	}
	return &Server{
		cfg:      cfg,
		cwd:      cwd,
		newModel: mf,
		dec:      json.NewDecoder(r),
		enc:      json.NewEncoder(w),
		sessions: map[string]*sessionState{},
		pending:  map[string]chan wireMessage{},
	}
}

// Serve runs the read-dispatch loop until EOF or a fatal decode error.
func (s *Server) Serve(ctx context.Context) error {
	for {
		var msg wireMessage
		if err := s.dec.Decode(&msg); err != nil {
			if errors.Is(err, io.EOF) {
				s.closeAll()
				return nil
			}
			return fmt.Errorf("lcp decode: %w", err)
		}
		switch {
		case msg.Method != "" && len(msg.ID) > 0:
			go s.handleRequest(ctx, msg)
		case len(msg.ID) > 0 && (msg.Result != nil || msg.Error != nil):
			s.resolvePending(msg)
		default:
			// client notification: currently none defined; ignore
		}
	}
}

// ---------------------------------------------------------------------------
// request handling
// ---------------------------------------------------------------------------

func (s *Server) handleRequest(ctx context.Context, msg wireMessage) {
	id := msg.ID
	var result any
	var err error
	switch msg.Method {
	case "initialize":
		result = s.initializeResult()
	case "session/new":
		result, err = s.sessionNew(ctx)
	case "session/resume":
		var p struct {
			SessionID string `json:"sessionId"`
		}
		if e := json.Unmarshal(msg.Params, &p); e != nil || p.SessionID == "" {
			err = errInvalidParams
			break
		}
		result, err = s.sessionResume(ctx, p.SessionID)
	case "session/continue":
		result, err = s.sessionContinue(ctx)
	case "session/list":
		result, err = s.sessionList(ctx)
	case "session/delete":
		var p struct {
			SessionID string `json:"sessionId"`
		}
		if e := json.Unmarshal(msg.Params, &p); e != nil || p.SessionID == "" {
			err = errInvalidParams
			break
		}
		result, err = s.sessionDelete(ctx, p.SessionID)
	case "session/close":
		var p struct {
			SessionID string `json:"sessionId"`
		}
		if e := json.Unmarshal(msg.Params, &p); e != nil || p.SessionID == "" {
			err = errInvalidParams
			break
		}
		s.closeSession(p.SessionID)
		result = map[string]any{"closed": true}
	case "turn/start":
		var p struct {
			SessionID string `json:"sessionId"`
			Input     string `json:"input"`
		}
		if e := json.Unmarshal(msg.Params, &p); e != nil || p.SessionID == "" || p.Input == "" {
			err = errInvalidParams
			break
		}
		result, err = s.turnStart(ctx, p.SessionID, p.Input)
	case "turn/cancel":
		var p struct {
			SessionID string `json:"sessionId"`
		}
		if e := json.Unmarshal(msg.Params, &p); e != nil || p.SessionID == "" {
			err = errInvalidParams
			break
		}
		result, err = s.turnCancel(p.SessionID)
	case "session/compact":
		var p struct {
			SessionID string `json:"sessionId"`
		}
		if e := json.Unmarshal(msg.Params, &p); e != nil || p.SessionID == "" {
			err = errInvalidParams
			break
		}
		result, err = s.sessionCompact(ctx, p.SessionID)
	case "session/user_shell":
		var p struct {
			SessionID string `json:"sessionId"`
			Command   string `json:"command"`
			TimeoutMs int    `json:"timeoutMs"`
		}
		if e := json.Unmarshal(msg.Params, &p); e != nil || p.SessionID == "" || p.Command == "" {
			err = errInvalidParams
			break
		}
		result, err = s.userShell(p.SessionID, p.Command, p.TimeoutMs)
	case "model/set":
		var p struct {
			SessionID string `json:"sessionId"`
			Model     string `json:"model"`
		}
		if e := json.Unmarshal(msg.Params, &p); e != nil || p.Model == "" {
			err = errInvalidParams
			break
		}
		result, err = s.modelSet(ctx, p.SessionID, p.Model)
	case "session/set_permission":
		var p struct {
			SessionID string `json:"sessionId"`
			Mode      string `json:"mode"`
		}
		if e := json.Unmarshal(msg.Params, &p); e != nil || p.SessionID == "" || p.Mode == "" {
			err = errInvalidParams
			break
		}
		result, err = s.sessionSetPermission(p.SessionID, p.Mode)
	case "model/list":
		result = s.modelList()
	case "config/get":
		result = map[string]any{
			"provider": s.cfg.Provider, "model": s.cfg.Model,
			"permission": s.cfg.Permission, "maxIters": s.cfg.MaxIters,
			"cwd": s.cwd, "brand": s.cfg.Brand,
		}
	default:
		err = errMethodNotFound
	}
	if err != nil {
		s.replyError(id, err)
		return
	}
	s.reply(id, result)
}

var (
	errMethodNotFound = errors.New("method not found")
	errInvalidParams  = errors.New("invalid params")
)

func (s *Server) initializeResult() map[string]any {
	return map[string]any{
		"protocolVersion": ProtocolVersion,
		"version":         config.Version,
		"brand":           s.cfg.Brand,
		"provider":        s.cfg.Provider,
		"model":           s.cfg.Model,
		"cwd":             s.cwd,
		"capabilities": map[string]bool{
			"approval": true, "sessions": true, "modelSet": true,
			"streaming": true, "thinking": true,
			"steering": true, "interrupt": true, "compact": true,
		},
	}
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

func (s *Server) sessionNew(ctx context.Context) (any, error) {
	cm, err := s.newModel(s.cfg)
	if err != nil {
		return nil, err
	}
	h, err := assemble.AgentWithModel(ctx, s.cfg, s.cwd, "", cm)
	if err != nil {
		return nil, err
	}
	if err := s.addSession(h); err != nil {
		h.Close()
		return nil, err
	}
	return map[string]any{"sessionId": h.SessionID}, nil
}

func (s *Server) sessionResume(ctx context.Context, id string) (any, error) {
	if _, ok := s.getSession(id); ok {
		return map[string]any{"sessionId": id, "resumed": true}, nil
	}
	cm, err := s.newModel(s.cfg)
	if err != nil {
		return nil, err
	}
	h, err := assemble.AgentWithModel(ctx, s.cfg, s.cwd, id, cm)
	if err != nil {
		return nil, err
	}
	if err := s.addSession(h); err != nil {
		h.Close()
		return nil, fmt.Errorf("resume session %s: %w", id, err)
	}
	return map[string]any{"sessionId": id, "resumed": true}, nil
}

func (s *Server) sessionContinue(ctx context.Context) (any, error) {
	saver, err := transcript.NewSaver(s.cwd)
	if err != nil {
		return nil, err
	}
	id, err := saver.NewestSessionID(ctx)
	if err != nil {
		return nil, err
	}
	if id == "" {
		return nil, errors.New("no session to continue in this project")
	}
	return s.sessionResume(ctx, id)
}

func (s *Server) sessionList(ctx context.Context) (any, error) {
	saver, err := transcript.NewSaver(s.cwd)
	if err != nil {
		return nil, err
	}
	infos, err := saver.ListSessions(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{"sessions": infos}, nil
}

func (s *Server) sessionDelete(ctx context.Context, id string) (any, error) {
	s.closeSession(id)
	saver, err := transcript.NewSaver(s.cwd)
	if err != nil {
		return nil, err
	}
	if err := saver.DeleteSession(ctx, id); err != nil {
		return nil, err
	}
	return map[string]any{"deleted": id}, nil
}

// addSession registers an assembled agent as a conversation-driven session
// and starts its persistent event drain. The conversation owns turn
// serialization: Submit queues during an active turn (steering), Interrupt
// aborts it, Compact runs at a safe boundary.
func (s *Server) addSession(h *assemble.Handle) error {
	conv, err := h.Agent.NewConversation(context.Background())
	if err != nil {
		return err
	}
	sctx, cancel := context.WithCancel(context.Background())
	st := &sessionState{h: h, conv: conv, sctx: sctx, cancel: cancel}
	h.Elicit = s.elicitFor(st, h.SessionID)
	s.sessionsMu.Lock()
	defer s.sessionsMu.Unlock()
	s.sessions[h.SessionID] = st
	go s.drainSession(h.SessionID, st)
	return nil
}

func (s *Server) getSession(id string) (*sessionState, bool) {
	s.sessionsMu.Lock()
	defer s.sessionsMu.Unlock()
	st, ok := s.sessions[id]
	return st, ok
}

func (s *Server) closeSession(id string) {
	s.sessionsMu.Lock()
	st, ok := s.sessions[id]
	if ok {
		delete(s.sessions, id)
	}
	s.sessionsMu.Unlock()
	if !ok {
		return
	}
	st.mu.Lock()
	st.closed = true
	st.mu.Unlock()
	// Close interrupts any active turn, stops the conversation and closes the
	// events channel (which ends the drain loop).
	_ = st.conv.Close()
	st.cancel()
	st.h.Close()
}

func (s *Server) closeAll() {
	s.sessionsMu.Lock()
	ids := make([]string, 0, len(s.sessions))
	for id := range s.sessions {
		ids = append(ids, id)
	}
	s.sessionsMu.Unlock()
	for _, id := range ids {
		s.closeSession(id)
	}
}

// ---------------------------------------------------------------------------
// turns
// ---------------------------------------------------------------------------

// turnStart queues user input on the session's conversation. With no active
// turn a new one starts; during a turn the input is steered into it at the
// next safe boundary (never splitting a tool_call/tool_result pair).
func (s *Server) turnStart(ctx context.Context, sessionID, input string) (any, error) {
	st, ok := s.getSession(sessionID)
	if !ok {
		return nil, fmt.Errorf("unknown session %q", sessionID)
	}
	st.mu.Lock()
	closed, busy := st.closed, st.turnActive
	st.mu.Unlock()
	if closed {
		return nil, fmt.Errorf("session %q is closed", sessionID)
	}
	if err := st.conv.Submit(input); err != nil {
		return nil, err
	}
	return map[string]any{"started": true, "queued": busy}, nil
}

// turnCancel interrupts the active turn (in-flight tool processes are killed,
// pending input is retained for the next turn, and the model sees an
// interruption marker). It reports whether a turn was running.
func (s *Server) turnCancel(sessionID string) (any, error) {
	st, ok := s.getSession(sessionID)
	if !ok {
		return nil, fmt.Errorf("unknown session %q", sessionID)
	}
	interrupted := st.conv.Interrupt()
	return map[string]any{"cancelled": interrupted}, nil
}

// sessionCompact forces a context compression: queued behind the active
// turn's safe boundary when a turn runs, immediate otherwise.
func (s *Server) sessionCompact(ctx context.Context, sessionID string) (any, error) {
	st, ok := s.getSession(sessionID)
	if !ok {
		return nil, fmt.Errorf("unknown session %q", sessionID)
	}
	if err := st.conv.Compact(ctx); err != nil {
		return nil, err
	}
	return map[string]any{"compacted": true}, nil
}

// userShell runs a user-typed command outside the model loop (codex `!`
// parity): output streams as user_shell_output events, user_shell_end carries
// the exit code. User-typed = authorized: the permission engine is bypassed
// by design, and the command never enters model context. Model-generated
// commands must go through turn/start instead.
func (s *Server) userShell(sessionID, command string, timeoutMs int) (any, error) {
	st, ok := s.getSession(sessionID)
	if !ok {
		return nil, fmt.Errorf("unknown session %q", sessionID)
	}
	st.mu.Lock()
	closed := st.closed
	st.mu.Unlock()
	if closed {
		return nil, fmt.Errorf("session %q is closed", sessionID)
	}
	timeout := time.Duration(timeoutMs) * time.Millisecond
	commandID, err := st.conv.RunUserShellCommand(command, timeout)
	if err != nil {
		return nil, err
	}
	return map[string]any{"commandId": commandID}, nil
}

// drainSession forwards the conversation's persistent event stream to the
// client for the session's whole lifetime, tracking turn activity and
// routing approval requests. The loop exits when the conversation closes.
func (s *Server) drainSession(sessionID string, st *sessionState) {
	for e := range st.conv.Events() {
		if rc, ok := e.(event.RequireUserConfirmEvent); ok {
			// Approval roundtrip runs alongside the drain loop; the agent
			// blocks in waitForConfirmation until SubmitUserConfirm lands.
			// The session ctx (not a turn ctx) bounds the wait so a pending
			// approval survives an interrupt but not a session close.
			go s.requestApproval(st.sctx, sessionID, rc)
		}
		switch e.(type) {
		case event.ReplyStartEvent:
			st.mu.Lock()
			st.turnActive = true
			st.mu.Unlock()
		case event.ReplyEndEvent:
			st.mu.Lock()
			st.turnActive = false
			st.mu.Unlock()
		}
		s.notifyEvent(sessionID, e)
	}
}

// sessionSetPermission mutates the live permission context. The engine takes
// its own lock per tool call, so a mode change applies from the next check.
func (s *Server) sessionSetPermission(sessionID, mode string) (any, error) {
	st, ok := s.getSession(sessionID)
	if !ok {
		return nil, fmt.Errorf("unknown session %q", sessionID)
	}
	switch permission.PermissionMode(mode) {
	case permission.ModeDefault, permission.ModeAcceptEdits, permission.ModeExplore,
		permission.ModeBypass, permission.ModeDontAsk:
	default:
		return nil, errInvalidParams
	}
	st.h.PCtx.Mode = permission.PermissionMode(mode)
	return map[string]any{"permission": mode}, nil
}

// modelList returns the embedded agentscope model cards for the current
// provider (context size, thinking support), powering the /model picker.
func (s *Server) modelList() any {
	cards := model.ListModels(s.cfg.Provider)
	type item struct {
		Name        string `json:"name"`
		Provider    string `json:"provider"`
		ContextSize int    `json:"contextSize,omitempty"`
		Thinking    bool   `json:"thinking,omitempty"`
	}
	out := make([]item, 0, len(cards))
	for _, c := range cards {
		out = append(out, item{
			Name: c.Name, Provider: c.Provider,
			ContextSize: c.ContextSize, Thinking: c.SupportsThinking(),
		})
	}
	return map[string]any{"models": out, "provider": s.cfg.Provider, "current": s.cfg.Model}
}

// modelSet swaps the model of a live session. UnifiedAgent exposes no
// SetModel, so turnwright re-assembles the agent over the checkpointed state —
// a pure assembly-layer operation. The conversation must be closed and
// recreated around the new agent; a turn in flight refuses the switch.
func (s *Server) modelSet(ctx context.Context, sessionID, modelName string) (any, error) {
	st, ok := s.getSession(sessionID)
	if !ok {
		return nil, fmt.Errorf("unknown session %q", sessionID)
	}
	st.mu.Lock()
	if st.closed {
		st.mu.Unlock()
		return nil, fmt.Errorf("session %q is closed", sessionID)
	}
	if st.turnActive {
		st.mu.Unlock()
		return nil, errors.New("session busy: switch models between turns")
	}
	st.mu.Unlock()

	newCfg := *s.cfg
	newCfg.Model = modelName
	cm, err := s.newModel(&newCfg)
	if err != nil {
		return nil, err
	}
	h, err := assemble.AgentWithModel(ctx, &newCfg, s.cwd, sessionID, cm)
	if err != nil {
		return nil, err
	}
	conv, err := h.Agent.NewConversation(st.sctx)
	if err != nil {
		h.Close()
		return nil, err
	}
	h.Elicit = s.elicitFor(st, sessionID)
	// End the old conversation (drain loop exits with its closed channel),
	// then swap handle + conversation under the lock.
	_ = st.conv.Close()
	st.mu.Lock()
	st.h.Close()
	st.h = h
	st.conv = conv
	st.mu.Unlock()
	go s.drainSession(sessionID, st)
	s.cfg.Model = modelName // future sessions follow the switch
	return map[string]any{"model": modelName}, nil
}

// ---------------------------------------------------------------------------
// approvals (server -> client request)
// ---------------------------------------------------------------------------

func (s *Server) requestApproval(ctx context.Context, sessionID string, rc event.RequireUserConfirmEvent) {
	id := fmt.Sprintf("srv-%d", s.seq.Add(1))
	ch := make(chan wireMessage, 1)
	s.pendingMu.Lock()
	s.pending[id] = ch
	s.pendingMu.Unlock()
	defer func() {
		s.pendingMu.Lock()
		delete(s.pending, id)
		s.pendingMu.Unlock()
	}()

	payload, err := eventjson.Marshal(rc)
	if err != nil {
		return
	}
	payload["session_id"] = sessionID
	s.wmu.Lock()
	_ = s.enc.Encode(map[string]any{
		"jsonrpc": "2.0", "id": id, "method": "approval/request", "params": payload,
	})
	s.wmu.Unlock()

	select {
	case resp := <-ch:
		var result struct {
			ConfirmResults []event.ConfirmResult `json:"confirmResults"`
		}
		if err := json.Unmarshal(resp.Result, &result); err == nil && len(result.ConfirmResults) > 0 {
			st, ok := s.getSession(sessionID)
			if ok {
				st.h.Agent.SubmitUserConfirm(&event.UserConfirmResultEvent{
					ReplyID:        rc.ReplyID,
					ConfirmResults: result.ConfirmResults,
				})
			}
		}
	case <-ctx.Done():
	}
}

// ---------------------------------------------------------------------------
// MCP elicitation (server -> client request)
// ---------------------------------------------------------------------------

// elicitFor wires an MCP elicitation handler that roundtrips to the TUI:
// the server sends an "elicitation/request" (message + optional form schema)
// and the client answers with an action (accept/decline/cancel) and, on
// accept, the submitted form content. The wait is bounded by the session
// lifetime — closing the session cancels outstanding elicitations.
func (s *Server) elicitFor(st *sessionState, sessionID string) func(mcp.ElicitRequest) (mcp.ElicitResponse, error) {
	return func(req mcp.ElicitRequest) (mcp.ElicitResponse, error) {
		id := fmt.Sprintf("el-%d", s.seq.Add(1))
		ch := make(chan wireMessage, 1)
		s.pendingMu.Lock()
		s.pending[id] = ch
		s.pendingMu.Unlock()
		defer func() {
			s.pendingMu.Lock()
			delete(s.pending, id)
			s.pendingMu.Unlock()
		}()

		params := map[string]any{
			"session_id": sessionID,
			"message":    req.Message,
		}
		if len(req.RequestedSchema) > 0 {
			params["requested_schema"] = req.RequestedSchema
		}
		s.wmu.Lock()
		_ = s.enc.Encode(map[string]any{
			"jsonrpc": "2.0", "id": id, "method": "elicitation/request", "params": params,
		})
		s.wmu.Unlock()

		select {
		case resp := <-ch:
			var result struct {
				Action  string         `json:"action"`
				Content map[string]any `json:"content"`
			}
			if err := json.Unmarshal(resp.Result, &result); err != nil || result.Action == "" {
				return mcp.ElicitResponse{Action: mcp.ElicitDecline}, nil
			}
			return mcp.ElicitResponse{Action: result.Action, Content: result.Content}, nil
		case <-st.sctx.Done():
			return mcp.ElicitResponse{Action: mcp.ElicitCancel}, nil
		}
	}
}

func (s *Server) resolvePending(msg wireMessage) {
	id := string(msg.ID)
	// ids come back as JSON strings: strip quotes
	var sid string
	if err := json.Unmarshal(msg.ID, &sid); err == nil {
		id = sid
	}
	s.pendingMu.Lock()
	ch, ok := s.pending[id]
	s.pendingMu.Unlock()
	if ok {
		ch <- msg
	}
}

// ---------------------------------------------------------------------------
// wire helpers
// ---------------------------------------------------------------------------

func (s *Server) notifyEvent(sessionID string, e event.Event) {
	payload, err := eventjson.Marshal(e)
	if err != nil {
		return
	}
	payload["session_id"] = sessionID
	s.notify("agent/event", payload)
}

func (s *Server) notify(method string, params any) {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	_ = s.enc.Encode(map[string]any{
		"jsonrpc": "2.0", "method": method, "params": params,
	})
}

func (s *Server) reply(id json.RawMessage, result any) {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	_ = s.enc.Encode(map[string]any{
		"jsonrpc": "2.0", "id": json.RawMessage(id), "result": result,
	})
}

func (s *Server) replyError(id json.RawMessage, err error) {
	code := -32603
	if errors.Is(err, errMethodNotFound) {
		code = -32601
	} else if errors.Is(err, errInvalidParams) {
		code = -32602
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	_ = s.enc.Encode(map[string]any{
		"jsonrpc": "2.0", "id": json.RawMessage(id),
		"error": wireError{Code: code, Message: err.Error()},
	})
}

// Compile-time assertion: the saver satisfies agentscope's StateSaver.
var _ agent.StateSaver = (*transcript.Saver)(nil)
