package mcp

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	point "github.com/phodal/pero/harness/go/runtime"
)

// ReplaceTools must atomically replace one owned generation, preserving the previous
// generation on failure. The returned disposer belongs to the calling runtime run.
type ReplaceTools func(*point.Run, string, []Tool) (point.Dispose, error)

// ConnectionOptions contains already-validated transport and connection policy.
type ConnectionOptions struct {
	ServerName         string
	Reconnect          ReconnectPolicy
	ToolCallTimeout    time.Duration
	FailOnStartupError bool
	TransportFactory   func() (mcp.Transport, error)
	ListTools          func(context.Context, *mcp.ClientSession) ([]*mcp.Tool, error)
	Resources          *ResourceDirectory
	// ToolPolicy, when set, limits the server to the operator's listed tools.
	ToolPolicy *ToolPolicy
}

type mcpGeneration struct {
	transport mcp.Transport
	id        uint64
	session   *mcp.ClientSession
	waitDone  chan struct{}
	waitErr   error
}

type mcpDownEvent struct {
	generation *mcpGeneration
	err        error
}

// trackedMCPTransport retains the raw connection so a failed initialize can
// still be closed even when the SDK returns no ClientSession. It preserves the
// optional protocol-version capability of the wrapped transport.
type trackedMCPTransport struct {
	inner mcp.Transport
	mu    sync.Mutex
	conn  mcp.Connection
}

func (t *trackedMCPTransport) Connect(ctx context.Context) (mcp.Connection, error) {
	connection, err := t.inner.Connect(ctx)
	t.mu.Lock()
	t.conn = connection
	t.mu.Unlock()
	return connection, err
}

func (t *trackedMCPTransport) SupportsProtocolVersion(version string) bool {
	if supporter, ok := t.inner.(mcp.ProtocolVersionSupporter); ok {
		return supporter.SupportsProtocolVersion(version)
	}
	return true
}

func (t *trackedMCPTransport) Close() error {
	t.mu.Lock()
	connection := t.conn
	t.conn = nil
	t.mu.Unlock()
	if connection == nil {
		return nil
	}
	return connection.Close()
}

// mcpConnectionSupervisor serializes connection, discovery, list-change, and
// reconnect transitions for one configured server. The tool registry keeps
// the last good generation during an outage and swaps only after a fresh
// connection has completed discovery.
type mcpConnectionSupervisor struct {
	ownerRun         *point.Run
	replaceTools     ReplaceTools
	serverName       string
	policy           ReconnectPolicy
	toolCallTimeout  time.Duration
	transportFactory func() (mcp.Transport, error)
	listTools        func(context.Context, *mcp.ClientSession) ([]*mcp.Tool, error)
	resources        *ResourceDirectory
	toolPolicy       *ToolPolicy

	nextGeneration   uint64
	activeGeneration atomic.Uint64
	current          *mcpGeneration
	disposers        []point.Dispose
	changes          chan uint64
	down             chan mcpDownEvent
	stop             chan struct{}
	stopOnce         sync.Once
	failedAttempts   int
	connectedAt      time.Time
}

// MountConnection connects one validated server and owns its supervisor for the run.
func MountConnection(ctx context.Context, run *point.Run, options ConnectionOptions, replaceTools ReplaceTools) error {
	listTools := options.ListTools
	if listTools == nil {
		listTools = ListTools
	}
	supervisor := &mcpConnectionSupervisor{
		ownerRun: run, replaceTools: replaceTools, serverName: options.ServerName,
		policy: options.Reconnect, toolCallTimeout: options.ToolCallTimeout,
		transportFactory: options.TransportFactory, listTools: listTools, resources: options.Resources, toolPolicy: options.ToolPolicy,
		changes: make(chan uint64, 8), down: make(chan mcpDownEvent, 8), stop: make(chan struct{}),
	}
	retrySafe, initialErr := supervisor.connect(ctx)
	if initialErr != nil && options.FailOnStartupError {
		return SafeError(errors.Join(initialErr, supervisor.shutdown()))
	}
	if err := run.Go("mcp:"+options.ServerName+":connection-supervisor", func(workerCtx context.Context) error {
		return supervisor.run(workerCtx, initialErr, retrySafe)
	}); err != nil {
		return SafeError(errors.Join(err, supervisor.shutdown()))
	}
	if initialErr != nil {
		run.Logger().Warn("MCP mounted without initial tools; see connection supervisor status", "mcp.server", options.ServerName)
	}
	return nil
}

func (s *mcpConnectionSupervisor) connect(ctx context.Context) (retrySafe bool, err error) {
	transport, err := s.transportFactory()
	if err != nil {
		return !errors.Is(err, ErrAuthentication), SafeError(fmt.Errorf("create transport: %w", err))
	}
	trackedTransport := &trackedMCPTransport{inner: transport}
	s.nextGeneration++
	generation := &mcpGeneration{id: s.nextGeneration, waitDone: make(chan struct{}), transport: transport}
	client := mcp.NewClient(&mcp.Implementation{Name: "point-harness", Version: "0.1.0"}, &mcp.ClientOptions{
		ToolListChangedHandler: func(context.Context, *mcp.ToolListChangedRequest) {
			if s.activeGeneration.Load() != generation.id {
				return
			}
			select {
			case s.changes <- generation.id:
			default:
			}
		},
	})
	session, err := client.Connect(ctx, trackedTransport, nil)
	if err != nil {
		closeErr := trackedTransport.Close()
		if errors.Is(closeErr, mcp.ErrConnectionClosed) {
			closeErr = nil
		}
		return closeErr == nil && !errors.Is(err, ErrAuthentication) && terminalTransportError(transport) == nil, SafeError(errors.Join(fmt.Errorf("connect: %w", err), closeErr))
	}
	generation.session = session
	s.current = generation
	s.activeGeneration.Store(generation.id)
	go s.waitForGeneration(generation)
	if err := s.syncGeneration(ctx, generation); err != nil {
		s.current = nil
		s.activeGeneration.Store(0)
		closeErr := closeMCPGeneration(generation)
		return closeErr == nil && !errors.Is(err, ErrAuthentication) && terminalTransportError(transport) == nil, SafeError(errors.Join(err, closeErr))
	}
	s.publishResourceSession(generation.session)
	s.connectedAt = time.Now()
	return true, nil
}

func (s *mcpConnectionSupervisor) publishResourceSession(session *mcp.ClientSession) {
	if s.resources != nil {
		s.resources.SetSession(s.serverName, session)
	}
}

func (s *mcpConnectionSupervisor) waitForGeneration(generation *mcpGeneration) {
	generation.waitErr = generation.session.Wait()
	close(generation.waitDone)
	select {
	case s.down <- mcpDownEvent{generation: generation, err: generation.waitErr}:
	case <-s.stop:
	}
}

func (s *mcpConnectionSupervisor) syncGeneration(ctx context.Context, generation *mcpGeneration) error {
	if s.current != generation || s.activeGeneration.Load() != generation.id {
		return nil
	}
	tools, err := s.listTools(ctx, generation.session)
	if err != nil {
		return fmt.Errorf("list tools: %w", err)
	}
	definitions, err := buildMCPTools(generation.session, s.serverName, tools, s.toolCallTimeout, s.toolPolicy)
	if err != nil {
		return err
	}
	replacement, err := s.replaceTools(s.ownerRun, "mcp:"+s.serverName, definitions)
	if err != nil {
		return fmt.Errorf("replace MCP tool generation: %w", err)
	}
	previous := s.disposers
	s.disposers = []point.Dispose{replacement}
	for _, dispose := range previous {
		_ = dispose(context.Background())
	}
	return nil
}

func (s *mcpConnectionSupervisor) clearTools(ctx context.Context) error {
	disposers := s.disposers
	s.disposers = nil
	var failures []error
	for _, dispose := range disposers {
		if err := dispose(ctx); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func (s *mcpConnectionSupervisor) run(ctx context.Context, initialErr error, retrySafe bool) (runErr error) {
	defer func() {
		runErr = SafeError(errors.Join(runErr, s.shutdown()))
	}()
	if initialErr != nil {
		s.ownerRun.Logger().Warn("MCP initial connection failed", "mcp.server", s.serverName, "error", SafeError(initialErr))
		if !retrySafe {
			return s.waitUntilCanceled(ctx)
		}
		s.failedAttempts = 1
	}
	for {
		if s.current == nil {
			if !s.policy.Enabled {
				s.ownerRun.Logger().Error("MCP reconnect disabled; waiting for owner reload", "mcp.server", s.serverName)
				return s.waitUntilCanceled(ctx)
			}
			if s.failedAttempts > s.policy.MaxAttempts {
				_ = s.clearTools(context.Background())
				s.ownerRun.Logger().Error("MCP reconnect attempts exhausted; tools unregistered",
					"mcp.server", s.serverName, "mcp.reconnect.max_attempts", s.policy.MaxAttempts)
				return nil
			}
			delay := s.reconnectDelay()
			s.ownerRun.Logger().Warn("MCP reconnect scheduled", "mcp.server", s.serverName,
				"mcp.reconnect.attempt", s.failedAttempts, "mcp.reconnect.max_attempts", s.policy.MaxAttempts,
				"mcp.reconnect.delay", delay)
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				if !timer.Stop() {
					<-timer.C
				}
				return nil
			case <-timer.C:
			}
			safe, err := s.connect(ctx)
			if err == nil {
				s.ownerRun.Logger().Info("MCP reconnected and tools synchronized", "mcp.server", s.serverName,
					"mcp.reconnect.attempt", s.failedAttempts)
				continue
			}
			if ctx.Err() != nil {
				return nil
			}
			s.ownerRun.Logger().Warn("MCP reconnect attempt failed", "mcp.server", s.serverName, "error", SafeError(err))
			if !safe {
				s.ownerRun.Logger().Error("MCP reconnect stopped; operator action or safe cleanup required", "mcp.server", s.serverName)
				return s.waitUntilCanceled(ctx)
			}
			s.failedAttempts++
			continue
		}

		select {
		case <-ctx.Done():
			return nil
		case generationID := <-s.changes:
			if s.current == nil || s.current.id != generationID {
				continue
			}
			if err := s.syncGeneration(ctx, s.current); err != nil && ctx.Err() == nil {
				s.ownerRun.Logger().Error("MCP tool-list resync failed", "mcp.server", s.serverName, "error", SafeError(err))
			}
		case event := <-s.down:
			if s.current != event.generation {
				continue
			}
			s.publishResourceSession(nil)
			s.activeGeneration.Store(0)
			s.current = nil
			stable := !s.connectedAt.IsZero() && time.Since(s.connectedAt) >= s.policy.MaxDelay
			s.connectedAt = time.Time{}
			if stable {
				s.failedAttempts = 0
			}
			if err := closeMCPGeneration(event.generation); err != nil {
				s.ownerRun.Logger().Error("MCP disconnected generation did not close; reconnect stopped to prevent overlap",
					"mcp.server", s.serverName, "error", SafeError(err))
				return s.waitUntilCanceled(ctx)
			}
			if errors.Is(event.err, ErrAuthentication) || terminalTransportError(event.generation.transport) != nil {
				s.ownerRun.Logger().Warn("MCP authentication rejected; waiting for owner reload", "mcp.server", s.serverName)
				return s.waitUntilCanceled(ctx)
			}
			s.failedAttempts++
			s.ownerRun.Logger().Warn("MCP connection lost", "mcp.server", s.serverName, "error", SafeError(event.err))
		}
	}
}

func (s *mcpConnectionSupervisor) reconnectDelay() time.Duration {
	delay := s.policy.InitialDelay
	for attempt := 1; attempt < s.failedAttempts && delay < s.policy.MaxDelay; attempt++ {
		if delay > s.policy.MaxDelay/2 {
			return s.policy.MaxDelay
		}
		delay *= 2
	}
	return min(delay, s.policy.MaxDelay)
}

func (s *mcpConnectionSupervisor) waitUntilCanceled(ctx context.Context) error {
	<-ctx.Done()
	return nil
}

func (s *mcpConnectionSupervisor) shutdown() error {
	s.stopOnce.Do(func() { close(s.stop) })
	s.publishResourceSession(nil)
	s.activeGeneration.Store(0)
	generation := s.current
	s.current = nil
	var closeErr error
	if generation != nil {
		closeErr = closeMCPGeneration(generation)
	}
	return errors.Join(closeErr, s.clearTools(context.Background()))
}

func closeMCPGeneration(generation *mcpGeneration) error {
	if generation == nil || generation.session == nil {
		return nil
	}
	deadline := time.NewTimer(mcpGenerationCloseTimeout)
	defer deadline.Stop()
	closed := make(chan error, 1)
	go func() { closed <- generation.session.Close() }()
	select {
	case err := <-closed:
		if errors.Is(err, mcp.ErrConnectionClosed) {
			err = nil
		}
		select {
		case <-generation.waitDone:
			return err
		case <-deadline.C:
			return errors.Join(err, errors.New("harness: MCP generation wait timed out"))
		}
	case <-deadline.C:
		return errors.New("harness: MCP generation close timed out")
	}
}

// Transport status survives SDK error flattening and unrelated later disconnects.
func terminalTransportError(transport mcp.Transport) error {
	if terminal, ok := transport.(interface{ TerminalError() error }); ok {
		return terminal.TerminalError()
	}
	return nil
}
