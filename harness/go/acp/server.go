// Package acp exposes Point Harness over Agent Client Protocol v1 NDJSON.
// ACP does not publish an official Go SDK, so this package deliberately keeps
// a narrow schema-backed JSON-RPC surface instead of inventing protocol types.
package acp

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

type Options struct {
	// ModelSelection opts into the registered provider's explicit local catalog.
	ModelSelection bool
	// ValidateWorkingDirectory is trusted native composition, not ACP client data.
	// It narrows session admission before persistence or MCP activation. Nil keeps
	// the protocol-only absolute-path behavior. Execution-time tool checks remain.
	ValidateWorkingDirectory func(string) error
	Harness                  *harness.Harness
	Persistence              harness.SessionPersistence
	Provider                 string
	Model                    string
	Compaction               *harness.BasicCompactionConfig
	ToolResultPruner         *harness.ToolResultPruneConfig
	Name                     string
	Version                  string
	SessionListPageSize      int
}

type Server struct {
	modelChoices             []harness.ModelCatalogEntry
	modelCapacity            int
	modelOutput              int
	validateWorkingDirectory func(string) error
	h                        *harness.Harness
	persistence              harness.SessionPersistence
	provider                 string
	model                    string
	compaction               *harness.BasicCompactionConfig
	toolResultPruner         *harness.ToolResultPruneConfig
	name                     string
	version                  string
	sessionListPageSize      int

	mu             sync.Mutex
	sessions       map[harness.SessionID]*activeSession
	activating     map[harness.SessionID]struct{}
	retiring       map[*harness.Agent]*activeSession
	closedSessions map[harness.SessionID]*activeSession
	operations     int
	operationWG    sync.WaitGroup
	closing        bool
	closeDone      chan struct{}
	closeErr       error
	retireErr      error
	nextID         uint64
	pending        map[string]chan clientResponse
	writer         *wireWriter
}

type clientResponse struct {
	result json.RawMessage
	err    error
}

type activeSession struct {
	projectionMu sync.Mutex
	stream       liveStream
	agent        *harness.Agent
	detachEvent  func()
	detachStore  func() error

	mu              sync.Mutex
	inflight        bool
	promptCancel    context.CancelFunc
	modelChanging   bool
	cancelRequested bool
	closing         bool
	closeDone       chan struct{}
	closeErr        error
	closeRequested  bool
	cleanupDone     chan struct{}
	cleanupErr      error
	commandActive   int
	commandsIdle    chan struct{}
}

type wireWriter struct {
	mu      sync.Mutex
	encoder *json.Encoder
	err     error
}

const maxJSONSafeInteger = uint64(1<<53 - 1)

func NewServer(options Options) (*Server, error) {
	if options.Harness == nil || options.Persistence == nil {
		return nil, errors.New("acp: harness and persistence are required")
	}
	if options.Name == "" {
		options.Name = "pero-agent-acp"
	}
	if options.Version == "" {
		options.Version = "0.1.0"
	}
	if options.SessionListPageSize == 0 {
		options.SessionListPageSize = 100
	}
	if options.SessionListPageSize < 1 || uint64(options.SessionListPageSize) > maxJSONSafeInteger {
		return nil, errors.New("acp: session list page size must be a positive safe integer")
	}
	choices, capacity, output, err := configuredModelChoices(options)
	if err != nil {
		return nil, err
	}
	return &Server{
		modelChoices: choices, modelCapacity: capacity, modelOutput: output,
		h: options.Harness, persistence: options.Persistence, validateWorkingDirectory: options.ValidateWorkingDirectory,
		provider: options.Provider, model: options.Model, compaction: options.Compaction, toolResultPruner: options.ToolResultPruner,
		name: options.Name, version: options.Version, sessionListPageSize: options.SessionListPageSize,
		sessions: make(map[harness.SessionID]*activeSession), activating: make(map[harness.SessionID]struct{}),
		pending: make(map[string]chan clientResponse), retiring: make(map[*harness.Agent]*activeSession), closedSessions: make(map[harness.SessionID]*activeSession),
	}, nil
}

// Serve processes concurrent JSON-RPC requests over newline-delimited JSON.
// Notifications remain readable while a prompt request is running, allowing
// session/cancel to interrupt a model or tool call.
func (s *Server) Serve(ctx context.Context, input io.Reader, output io.Writer) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	s.mu.Lock()
	s.writer = &wireWriter{encoder: json.NewEncoder(output)}
	s.mu.Unlock()
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	var wait sync.WaitGroup
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		var message request
		if err := json.Unmarshal(line, &message); err != nil || message.JSONRPC != "2.0" {
			_ = s.writer.write(response{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcError{Code: -32700, Message: "parse error"}})
			continue
		}
		if message.Method == "" {
			if len(message.ID) > 0 {
				s.handleClientResponse(message)
				continue
			}
			_ = s.writer.write(response{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcError{Code: -32600, Message: "invalid request"}})
			continue
		}
		if len(message.ID) == 0 {
			s.handleNotification(message)
			continue
		}
		wait.Add(1)
		go func() {
			defer wait.Done()
			result, rpcErr := s.handle(ctx, message)
			_ = s.writer.write(response{JSONRPC: "2.0", ID: message.ID, Result: result, Error: rpcErr})
		}()
	}
	readErr := scanner.Err()
	if ctx.Err() != nil && (errors.Is(readErr, os.ErrClosed) || errors.Is(readErr, io.ErrClosedPipe) || errors.Is(readErr, context.Canceled)) {
		readErr = nil // expected cancellation read error, never session flush/close errors
	}
	cancel()
	s.failPending(io.EOF)
	closeErr := s.closeAll(context.Background())
	wait.Wait()
	return errors.Join(readErr, s.writer.currentError(), closeErr)
}

func (s *Server) handleClientResponse(message request) {
	key := string(message.ID)
	s.mu.Lock()
	pending := s.pending[key]
	if pending != nil {
		delete(s.pending, key)
	}
	s.mu.Unlock()
	if pending == nil {
		return
	}
	if message.Error != nil {
		pending <- clientResponse{err: errors.New(message.Error.Message)}
	} else {
		pending <- clientResponse{result: append(json.RawMessage(nil), message.Result...)}
	}
}

func (s *Server) requestClient(ctx context.Context, method string, params any) (json.RawMessage, error) {
	s.mu.Lock()
	s.nextID++
	id := fmt.Sprintf("point-%d", s.nextID)
	idJSON, _ := json.Marshal(id)
	key := string(idJSON)
	result := make(chan clientResponse, 1)
	s.pending[key] = result
	s.mu.Unlock()
	if err := s.writer.write(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
		s.mu.Lock()
		delete(s.pending, key)
		s.mu.Unlock()
		return nil, err
	}
	select {
	case response := <-result:
		return response.result, response.err
	case <-ctx.Done():
		s.mu.Lock()
		delete(s.pending, key)
		s.mu.Unlock()
		return nil, ctx.Err()
	}
}

func (s *Server) failPending(err error) {
	s.mu.Lock()
	pending := make([]chan clientResponse, 0, len(s.pending))
	for key, waiter := range s.pending {
		delete(s.pending, key)
		pending = append(pending, waiter)
	}
	s.mu.Unlock()
	for _, waiter := range pending {
		waiter <- clientResponse{err: err}
	}
}

func (w *wireWriter) write(value any) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.err != nil {
		return w.err
	}
	w.err = w.encoder.Encode(value)
	return w.err
}

func (w *wireWriter) currentError() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.err
}

func (s *Server) handle(ctx context.Context, message request) (any, *rpcError) {
	switch message.Method {
	case "initialize":
		imagePrompts := s.h.Attachments() != nil
		return map[string]any{
			"protocolVersion": ProtocolVersion,
			"agentInfo":       map[string]any{"name": s.name, "version": s.version},
			"agentCapabilities": map[string]any{
				"loadSession":         true,
				"mcpCapabilities":     map[string]any{"http": true},
				"promptCapabilities":  map[string]any{"image": imagePrompts, "audio": false, "embeddedContext": false},
				"sessionCapabilities": map[string]any{"close": map[string]any{}, "list": map[string]any{}, "resume": map[string]any{}},
			},
			"authMethods": []any{},
		}, nil
	case "authenticate":
		return map[string]any{}, nil
	case "session/new":
		var params NewSessionParams
		if err := decodeParams(message.Params, &params); err != nil {
			return nil, invalid(err.Error())
		}
		id, err := s.newSession(ctx, params)
		if err != nil {
			return nil, classify(err)
		}
		return s.sessionConfiguration(id, true)
	case "session/set_config_option":
		var params setConfigOptionParams
		if err := decodeParams(message.Params, &params); err != nil {
			return nil, invalid(err.Error())
		}
		return s.setConfigOption(ctx, params)
	case "session/prompt":
		var params PromptParams
		if err := decodeParams(message.Params, &params); err != nil {
			return nil, invalid(err.Error())
		}
		stop, err := s.prompt(ctx, params)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"stopReason": stop}, nil
	case "session/close":
		var params SessionParams
		if err := decodeParams(message.Params, &params); err != nil {
			return nil, invalid(err.Error())
		}
		if err := s.closeSession(ctx, harness.SessionID(params.SessionID)); err != nil {
			return nil, classify(err)
		}
		return map[string]any{}, nil
	case "session/resume":
		var params ResumeSessionParams
		if err := decodeParams(message.Params, &params); err != nil {
			return nil, invalid(err.Error())
		}
		if err := s.resumeSession(ctx, params); err != nil {
			return nil, classify(err)
		}
		return s.sessionConfiguration(harness.SessionID(params.SessionID), false)
	case "session/load":
		var params ResumeSessionParams
		if err := decodeParams(message.Params, &params); err != nil {
			return nil, invalid(err.Error())
		}
		if err := s.resumeSession(ctx, params); err != nil {
			return nil, classify(err)
		}
		if err := s.replaySessionHistory(harness.SessionID(params.SessionID)); err != nil {
			_ = s.closeSession(context.Background(), harness.SessionID(params.SessionID))
			return nil, classify(err)
		}
		return s.sessionConfiguration(harness.SessionID(params.SessionID), false)
	case "session/list":
		var params ListSessionParams
		if len(message.Params) > 0 {
			if err := decodeParams(message.Params, &params); err != nil {
				return nil, invalid(err.Error())
			}
		}
		result, err := s.listSessions(ctx, params)
		if err != nil {
			return nil, classify(err)
		}
		return result, nil
	case harness.CommandListMethod:
		var params CommandListParams
		if err := decodeParams(message.Params, &params); err != nil {
			return nil, invalid(err.Error())
		}
		record, err := s.currentRecord(harness.SessionID(params.AgentID))
		if err != nil {
			return nil, classify(err)
		}
		commands, err := s.h.Commands().ListForAgent(ctx, record.agent)
		if err != nil {
			return nil, classify(err)
		}
		return map[string]any{"commands": commands}, nil
	case harness.CommandExecuteMethod:
		var params CommandExecuteParams
		if err := decodeParams(message.Params, &params); err != nil {
			return nil, invalid(err.Error())
		}
		record, finish, err := s.beginCommandRecord(params.AgentID)
		if err != nil {
			return nil, classify(err)
		}
		defer finish()
		execution, matched, err := s.h.Commands().Execute(ctx, record.agent, params.Line, params.Images...)
		if err != nil {
			return nil, classify(err)
		}
		if !matched {
			return harness.CommandRemoteExecution{}, nil
		}
		return harness.CommandRemoteExecution{Matched: true, Execution: &execution}, nil
	default:
		return nil, &rpcError{Code: -32601, Message: "method not found: " + message.Method}
	}
}

func (s *Server) handleNotification(message request) {
	if message.Method != "session/cancel" {
		return
	}
	var params SessionParams
	if decodeParams(message.Params, &params) != nil {
		return
	}
	s.mu.Lock()
	record := s.sessions[harness.SessionID(params.SessionID)]
	s.mu.Unlock()
	if record != nil {
		record.mu.Lock()
		record.cancelRequested = true
		cancel := record.promptCancel
		record.mu.Unlock()
		if cancel != nil {
			cancel()
		}
		// Preserve synchronous cancellation of an already active turn; the
		// prompt context also covers admission before that turn exists.
		record.agent.Cancel(context.Canceled)
	}
}

func (s *Server) newSession(ctx context.Context, params NewSessionParams) (harness.SessionID, error) {
	done, err := s.beginSessionOperation(ctx)
	if err != nil {
		return "", err
	}
	defer done()
	if err := s.checkWorkingDirectory(params.CWD); err != nil {
		return "", err
	}
	if len(params.AdditionalDirectories) > 0 {
		return "", invalidError("additionalDirectories is not supported")
	}
	servers, err := decodeMCPServers(params.MCPServers, params.CWD)
	if err != nil {
		return "", err
	}
	id, err := randomSessionID()
	if err != nil {
		return "", err
	}
	agent, err := s.h.Agents().Create(ctx, harness.AgentOptions{
		ID: id, CWD: params.CWD, Provider: s.provider, Model: s.model, Compaction: s.compaction,
		ToolResultPruner: s.toolResultPruner,
		Configure: func(setup context.Context, run *point.Run, _ *harness.Agent) error {
			if _, err := s.h.Approvals().Register(run, s.requestApproval); err != nil {
				return err
			}
			return harness.MountMCPServers(setup, run, s.h.Tools(), s.h.Prompts(), servers)
		},
	})
	if err != nil {
		return "", err
	}
	if _, err := agent.Session().Append("session/acp-controller", map[string]any{"version": 1, "requiresClientMCP": len(servers) != 0}); err != nil {
		s.retireAgent(agent)
		return "", err
	}
	if err := ensureAutoReview(agent); err != nil {
		s.retireAgent(agent)
		return "", err
	}
	if err := s.activate(ctx, agent); err != nil {
		s.retireAgent(agent)
		return "", err
	}
	return id, nil
}

func (s *Server) activate(ctx context.Context, agent *harness.Agent) error {
	return s.activateWithPolicy(ctx, agent, nil, true)
}

func (s *Server) activateWithPolicy(ctx context.Context, agent *harness.Agent, attached func() error, resumeInbox bool) (resultErr error) {
	done, err := s.beginSessionOperation(ctx)
	if err != nil {
		return err
	}
	defer done()
	record := newActiveSession(agent)
	s.mu.Lock()
	if s.closing || s.sessions[agent.ID()] != nil || s.retiring[agent] != nil {
		s.mu.Unlock()
		return invalidError("session admission unavailable: " + string(agent.ID()))
	}
	prepared, err := s.h.Agents().RegisterCleanup(agent, func(context.Context) error { return s.finishSession(record) })
	if err != nil {
		s.mu.Unlock()
		return err
	}
	s.retiring[agent] = record
	s.mu.Unlock()
	committed := false
	defer func() {
		prepared()
		if !committed {
			s.requestRecordClose(record)
		}
	}()
	record.detachStore = attached
	if attached == nil {
		detachStore, err := s.persistence.Attach(ctx, agent.Session())
		if err != nil && (!errors.Is(err, harness.ErrSessionDurabilityAttached) || !agent.Session().DurabilityAttached()) {
			return err
		}
		if err == nil {
			record.detachStore = detachStore
		}
	}
	record.detachEvent = agent.Session().Subscribe(func(event harness.Event) { s.projectLive(record, event) })
	s.mu.Lock()
	current, live := s.h.Agents().Get(agent.ID())
	if s.closing || !live || current != agent || s.sessions[agent.ID()] != nil || ctx.Err() != nil {
		s.mu.Unlock()
		return invalidError("session retired before publication: " + string(agent.ID()))
	}
	s.sessions[agent.ID()] = record
	delete(s.closedSessions, agent.ID())
	delete(s.retiring, agent)
	s.mu.Unlock()
	if resumeInbox {
		if err := agent.ResumeDurableInbox(); err != nil {
			return err
		}
	}
	committed = true
	return nil
}

func (s *Server) prompt(ctx context.Context, params PromptParams) (string, error) {
	record, err := s.currentRecord(harness.SessionID(params.SessionID))
	if err != nil {
		return "", err
	}
	record.mu.Lock()
	if record.closing {
		record.mu.Unlock()
		return "", invalidError("session is closing: " + params.SessionID)
	}
	if record.inflight || record.modelChanging {
		record.mu.Unlock()
		return "", invalidError("session already has an active prompt: " + params.SessionID)
	}
	// The prompt owns cancellation from admission through settlement, including
	// the interval before the Agent has installed its active-turn canceler.
	promptCtx, cancel := context.WithCancel(ctx)
	record.inflight = true
	record.promptCancel = cancel
	record.cancelRequested = false
	record.mu.Unlock()
	defer cancel()
	content, promptErr := promptBlocks(promptCtx, s.h.Attachments(), params.Prompt)
	var result harness.TurnResult
	if promptErr == nil {
		result, promptErr = record.agent.Prompt(promptCtx, harness.Message{Role: harness.RoleUser, Content: content})
		// Prompt can return as soon as its context is canceled. Retain the ACP
		// slot until the worker has stopped, so the next turn cannot overlap it.
		if promptCtx.Err() != nil {
			promptErr = errors.Join(promptErr, record.agent.WhenIdle(context.WithoutCancel(ctx)))
		}
	}
	record.mu.Lock()
	cancelled := record.cancelRequested
	record.inflight = false
	record.promptCancel = nil
	record.mu.Unlock()
	if cancelled {
		return "cancelled", nil
	}
	if promptErr != nil {
		return "", promptErr
	}
	return promptStopReason(result.Reason), nil
}

func promptStopReason(reason harness.FinishKind) string {
	switch reason {
	case harness.FinishMaxTokens:
		return "max_tokens"
	case harness.FinishRefusal:
		return "refusal"
	default:
		return "end_turn"
	}
}

func (s *Server) closeSession(ctx context.Context, id harness.SessionID) error {
	s.mu.Lock()
	record := s.sessions[id]
	if record == nil {
		record = s.closedSessions[id]
	}
	s.mu.Unlock()
	if record == nil {
		return invalidError("unknown session: " + string(id))
	}
	s.requestRecordClose(record)
	return waitRecordClose(ctx, record)
}

func (s *Server) checkCommandAgent(agentID string) error {
	if agentID == "" {
		return invalidError("agentId must not be empty")
	}
	_, err := s.currentRecord(harness.SessionID(agentID))
	return err
}

func (s *Server) beginCommand(agentID string) (func(), error) {
	_, finish, err := s.beginCommandRecord(agentID)
	return finish, err
}

func (s *Server) beginCommandRecord(agentID string) (*activeSession, func(), error) {
	if agentID == "" {
		return nil, nil, invalidError("agentId must not be empty")
	}
	record, err := s.currentRecord(harness.SessionID(agentID))
	if err != nil {
		return nil, nil, err
	}
	record.mu.Lock()
	if record.closing {
		record.mu.Unlock()
		return nil, nil, invalidError("session is closing: " + agentID)
	}
	if record.modelChanging {
		record.mu.Unlock()
		return nil, nil, invalidError("session model is changing: " + agentID)
	}
	if record.commandActive == 0 {
		record.commandsIdle = make(chan struct{})
	}
	record.commandActive++
	record.mu.Unlock()
	var once sync.Once
	return record, func() {
		once.Do(func() {
			record.mu.Lock()
			record.commandActive--
			if record.commandActive == 0 {
				close(record.commandsIdle)
			}
			record.mu.Unlock()
		})
	}, nil
}

func waitForACPCommands(ctx context.Context, idle <-chan struct{}) error {
	select {
	case <-idle:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Server) resumeSession(ctx context.Context, params ResumeSessionParams) error {
	done, err := s.beginSessionOperation(ctx)
	if err != nil {
		return err
	}
	defer done()
	if err := s.checkWorkingDirectory(params.CWD); err != nil {
		return err
	}
	id := harness.SessionID(params.SessionID)
	s.mu.Lock()
	_, active := s.sessions[id]
	_, activating := s.activating[id]
	if !active && !activating {
		s.activating[id] = struct{}{}
	}
	s.mu.Unlock()
	if active || activating {
		return invalidError("session is already active: " + params.SessionID)
	}
	if _, globallyActive := s.h.Agents().Get(id); globallyActive {
		s.mu.Lock()
		delete(s.activating, id)
		s.mu.Unlock()
		return invalidError("session is already active: " + params.SessionID)
	}
	defer func() {
		s.mu.Lock()
		delete(s.activating, id)
		s.mu.Unlock()
	}()
	session, err := s.persistence.Load(ctx, id)
	if err != nil {
		return invalidError("session is not resumable: " + params.SessionID)
	}
	if !sameDirectory(session.Header().CWD, params.CWD) {
		return invalidError("session cwd does not match: " + params.CWD)
	}
	if err := checkMCPResumeRequirements(session.Events(), len(params.MCPServers) > 0); err != nil {
		return err
	}
	if err := s.checkRestoredModel(ctx, session); err != nil {
		return err
	}
	servers, err := decodeMCPServers(params.MCPServers, params.CWD)
	if err != nil {
		return err
	}
	agent, err := s.h.Agents().Resume(ctx, session, harness.AgentOptions{
		Provider: s.provider, Model: s.model, Compaction: s.compaction, ToolResultPruner: s.toolResultPruner,
		Configure: func(setup context.Context, run *point.Run, _ *harness.Agent) error {
			if _, err := s.h.Approvals().Register(run, s.requestApproval); err != nil {
				return err
			}
			return harness.MountMCPServers(setup, run, s.h.Tools(), s.h.Prompts(), servers)
		},
	})
	if err != nil {
		return err
	}
	if _, err := agent.Session().Append("session/acp-controller", map[string]any{"version": 1, "requiresClientMCP": len(servers) != 0}); err != nil {
		s.retireAgent(agent)
		return err
	}
	if err := ensureAutoReview(agent); err != nil {
		s.retireAgent(agent)
		return err
	}
	if err := s.activate(ctx, agent); err != nil {
		s.retireAgent(agent)
		return err
	}
	return nil
}

// checkMCPResumeRequirements interprets only the latest controller receipt.
// Presence is not configuration equivalence: current ACP callers still own the
// explicitly supplied server configuration. No endpoints or secrets are stored.
func checkMCPResumeRequirements(events []harness.Event, supplied bool) error {
	for index := len(events) - 1; index >= 0; index-- {
		if events[index].Type != "session/acp-controller" {
			continue
		}
		var receipt struct {
			Version           *int  `json:"version"`
			RequiresClientMCP *bool `json:"requiresClientMCP"`
		}
		if err := json.Unmarshal(events[index].Data, &receipt); err != nil || receipt.Version == nil || *receipt.Version != 1 || receipt.RequiresClientMCP == nil {
			return invalidError("session ACP controller requirements are unreadable or unsupported; resume refused")
		}
		if *receipt.RequiresClientMCP && !supplied {
			return invalidError("session requires client-provided MCP servers; resend mcpServers to resume")
		}
		return nil
	}
	return nil // Sessions predating controller receipts retain their existing contract.
}

func (s *Server) requestApproval(ctx context.Context, request harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
	// ACP v1 defines request_permission as a machine-policy decision over a
	// tool call, not as a generic human-question transport. Keep userQuestions
	// unclaimed here, matching DSH ACP, instead of encoding arbitrary answers
	// into permission option IDs that compliant clients cannot interpret.
	params := map[string]any{
		"sessionId": request.Agent.ID(),
		"toolCall":  map[string]any{"toolCallId": request.CallID},
		"options": []any{
			map[string]any{"optionId": "allow-once", "name": "Allow once", "kind": "allow_once"},
			map[string]any{"optionId": "reject-once", "name": "Reject", "kind": "reject_once"},
		},
	}
	if request.Native != nil {
		params["_meta"] = map[string]any{"pero.dev/native-approval": *request.Native}
	}
	raw, err := s.requestClient(ctx, "session/request_permission", params)
	if err != nil {
		return harness.ApprovalUnavailable, err
	}
	var response struct {
		Outcome struct {
			Outcome  string `json:"outcome"`
			OptionID string `json:"optionId"`
		} `json:"outcome"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		return harness.ApprovalUnavailable, err
	}
	if response.Outcome.Outcome == "cancelled" {
		return harness.ApprovalCancelled, nil
	}
	if response.Outcome.Outcome != "selected" {
		return harness.ApprovalUnavailable, nil
	}
	if response.Outcome.OptionID == "allow-once" {
		return harness.ApprovalAllowedOnce, nil
	}
	return harness.ApprovalRejected, nil
}

func (s *Server) closeAll(ctx context.Context) error {
	err := s.Close(ctx)
	if err == ErrServerCloseInProgress {
		err = nil
	}
	return errors.Join(err, s.Drain(ctx))
}

func decodeParams(raw json.RawMessage, target any) error {
	if len(raw) == 0 {
		return errors.New("missing params")
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func promptBlocks(ctx context.Context, attachments harness.AttachmentStore, input []PromptContent) ([]harness.ContentBlock, error) {
	result := make([]harness.ContentBlock, 0, len(input))
	for _, block := range input {
		switch block.Type {
		case "text":
			result = append(result, harness.ContentBlock{Type: harness.BlockText, Text: block.Text})
		case "resource_link":
			result = append(result, harness.ContentBlock{Type: harness.BlockText, Text: fmt.Sprintf("\n[resource_link name=%q uri=%q]\n", block.Name, block.URI)})
		case "image":
			if attachments == nil {
				return nil, invalidError("image prompt content is not supported")
			}
			refs, err := harness.AdmitEncodedImages(ctx, attachments, []harness.EncodedImageAttachment{{
				Data: block.Data, MediaType: block.MIMEType, Name: block.Name,
			}})
			if err != nil {
				return nil, invalidError(err.Error())
			}
			ref := refs[0]
			result = append(result, harness.ContentBlock{Type: harness.BlockImage, Attachment: &ref})
		case "audio", "resource":
			return nil, invalidError(block.Type + " prompt content is not supported")
		default:
			return nil, invalidError("unsupported prompt content")
		}
	}
	for _, block := range result {
		if block.Type == harness.BlockImage || strings.TrimSpace(block.Text) != "" {
			return result, nil
		}
	}
	return nil, invalidError("empty prompt")
}

func decodeMCPServers(raw []json.RawMessage, cwd string) ([]harness.MCPServerConfig, error) {
	result := make([]harness.MCPServerConfig, 0, len(raw))
	for index, entry := range raw {
		var probe struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(entry, &probe); err != nil {
			return nil, invalidError(fmt.Sprintf("mcpServers[%d] is invalid", index))
		}
		if probe.Type == "" {
			var server struct {
				Name    string                         `json:"name"`
				Command string                         `json:"command"`
				Args    []string                       `json:"args"`
				Env     []struct{ Name, Value string } `json:"env"`
			}
			if err := json.Unmarshal(entry, &server); err != nil {
				return nil, invalidError(fmt.Sprintf("mcpServers[%d] is invalid", index))
			}
			env := make(map[string]string, len(server.Env))
			for _, pair := range server.Env {
				if _, exists := env[pair.Name]; exists {
					return nil, invalidError(fmt.Sprintf("mcpServers[%d].env contains duplicate name: %s", index, pair.Name))
				}
				env[pair.Name] = pair.Value
			}
			result = append(result, harness.MCPServerConfig{Name: server.Name, Transport: harness.MCPStdio, Command: server.Command, Args: server.Args, Env: env, CWD: cwd})
			continue
		}
		if probe.Type != "http" {
			return nil, invalidError(fmt.Sprintf("mcpServers[%d] transport %s is not supported", index, probe.Type))
		}
		var server struct {
			Type    string                         `json:"type"`
			Name    string                         `json:"name"`
			URL     string                         `json:"url"`
			Headers []struct{ Name, Value string } `json:"headers"`
		}
		if err := json.Unmarshal(entry, &server); err != nil {
			return nil, invalidError(fmt.Sprintf("mcpServers[%d] is invalid", index))
		}
		headers := make(map[string]string, len(server.Headers))
		identities := make(map[string]struct{}, len(server.Headers))
		for _, pair := range server.Headers {
			identity := strings.ToLower(pair.Name)
			if _, exists := identities[identity]; exists {
				return nil, invalidError(fmt.Sprintf("mcpServers[%d].headers contains duplicate name: %s", index, pair.Name))
			}
			identities[identity] = struct{}{}
			headers[pair.Name] = pair.Value
		}
		result = append(result, harness.MCPServerConfig{Name: server.Name, Transport: harness.MCPStreamableHTTP, URL: server.URL, Headers: headers})
	}
	return result, nil
}

func (s *Server) checkWorkingDirectory(cwd string) error {
	if err := validateCWD(cwd); err != nil {
		return err
	}
	if s.validateWorkingDirectory != nil {
		if err := s.validateWorkingDirectory(cwd); err != nil {
			return invalidError("session working directory is unavailable: " + err.Error())
		}
	}
	return nil
}

func validateCWD(cwd string) error {
	if cwd == "" || !filepath.IsAbs(cwd) {
		return invalidError("cwd must be an absolute path: " + cwd)
	}
	return nil
}

func sameDirectory(left, right string) bool {
	leftReal, leftErr := filepath.EvalSymlinks(left)
	rightReal, rightErr := filepath.EvalSymlinks(right)
	if leftErr == nil && rightErr == nil {
		return leftReal == rightReal
	}
	return filepath.Clean(left) == filepath.Clean(right)
}

func randomSessionID() (harness.SessionID, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	bytes[6] = bytes[6]&0x0f | 0x40
	bytes[8] = bytes[8]&0x3f | 0x80
	encoded := hex.EncodeToString(bytes[:])
	return harness.SessionID(encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:]), nil
}

type invalidParamError string

func (e invalidParamError) Error() string { return string(e) }
func invalidError(message string) error   { return invalidParamError(message) }
func invalid(message string) *rpcError    { return &rpcError{Code: -32602, Message: message} }

func classify(err error) *rpcError {
	var invalidParam invalidParamError
	if errors.As(err, &invalidParam) {
		return invalid(err.Error())
	}
	return &rpcError{Code: -32603, Message: err.Error()}
}
