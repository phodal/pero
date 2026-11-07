package acp

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/phodal/pero/harness/go/harness"
)

var ErrServerCloseInProgress = fmt.Errorf("acp: close is in progress: %w", harness.ErrAgentDisposalInProgress)

func (s *Server) beginSessionOperation(ctx context.Context) (func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.closing {
		return nil, errors.New("acp: server is closing")
	}
	s.operations++
	s.operationWG.Add(1)
	var once sync.Once
	return func() { once.Do(func() { s.mu.Lock(); s.operations--; s.mu.Unlock(); s.operationWG.Done() }) }, nil
}

// Close seals admission and requests one owned cleanup. Callbacks receive an
// explicit pending result instead of waiting for their own stack to return.
// Drain is the final receipt for an outer lifecycle owner.
func (s *Server) Close(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	busy := s.h.DisposalWouldBlock()
	s.mu.Lock()
	if s.closeDone != nil {
		done := s.closeDone
		s.mu.Unlock()
		select {
		case <-done:
			return s.Drain(ctx)
		default:
			return ErrServerCloseInProgress
		}
	}
	s.closing = true
	s.closeDone = make(chan struct{})
	busy = busy || s.operations != 0 || len(s.retiring) != 0
	for _, record := range s.sessions {
		record.mu.Lock()
		busy = busy || record.inflight || record.commandActive != 0 || record.closing
		record.mu.Unlock()
	}
	s.mu.Unlock()
	go func() {
		s.operationWG.Wait()
		s.mu.Lock()
		records := make(map[*activeSession]struct{}, len(s.sessions)+len(s.retiring))
		for _, record := range s.sessions {
			records[record] = struct{}{}
		}
		for _, record := range s.retiring {
			records[record] = struct{}{}
		}
		s.mu.Unlock()
		for record := range records {
			s.requestRecordClose(record)
		}
		for record := range records {
			_ = waitRecordClose(context.Background(), record)
		}
		s.mu.Lock()
		s.closeErr = s.retireErr
		close(s.closeDone)
		s.mu.Unlock()
	}()
	if busy {
		return ErrServerCloseInProgress
	}
	return s.Drain(ctx)
}

func (s *Server) Drain(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	s.mu.Lock()
	done := s.closeDone
	s.mu.Unlock()
	if done == nil {
		return errors.New("acp: close has not been requested")
	}
	select {
	case <-done:
	case <-ctx.Done():
		return ctx.Err()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closeErr
}

func newActiveSession(agent *harness.Agent) *activeSession {
	idle := make(chan struct{})
	close(idle)
	return &activeSession{agent: agent, closeDone: make(chan struct{}), commandsIdle: idle}
}

// retireAgent retains a rollback receipt even when admission failed before the
// Session resources could register with the manager. Never reacquire by ID.
func (s *Server) retireAgent(agent *harness.Agent) {
	if agent == nil {
		return
	}
	s.mu.Lock()
	record := s.retiring[agent]
	if current := s.sessions[agent.ID()]; current != nil && current.agent == agent {
		record = current
	}
	if record == nil {
		record = newActiveSession(agent)
		s.retiring[agent] = record
	}
	s.mu.Unlock()
	s.requestRecordClose(record)
}

func (s *Server) requestRecordClose(record *activeSession) {
	record.mu.Lock()
	if record.closeRequested {
		record.mu.Unlock()
		return
	}
	record.closeRequested = true
	record.closing = true
	record.cancelRequested = true
	promptCancel := record.promptCancel
	record.mu.Unlock()
	record.agent.MCPAccess().Close()
	if promptCancel != nil {
		promptCancel()
	}
	s.mu.Lock()
	s.retiring[record.agent] = record
	s.mu.Unlock()
	// Withdrawal precedes asynchronous joins and remains exact even after reuse.
	requestCtx, cancel := context.WithCancel(context.Background())
	cancel()
	requestErr := s.h.Agents().RemoveExact(requestCtx, record.agent)
	if requestErr == harness.ErrAgentDisposalInProgress || requestErr == context.Canceled {
		requestErr = nil
	}
	go func() {
		receiptErr := s.h.Agents().WaitRetired(context.Background(), record.agent)
		cleanupErr := s.finishSession(record)
		record.mu.Lock()
		cleanupDone := record.cleanupDone
		record.mu.Unlock()
		if cleanupDone != nil {
			<-cleanupDone
			record.mu.Lock()
			cleanupErr = record.cleanupErr
			record.mu.Unlock()
		}
		result := errors.Join(requestErr, receiptErr, cleanupErr)
		s.mu.Lock()
		if s.sessions[record.agent.ID()] == record {
			delete(s.sessions, record.agent.ID())
		}
		if s.retiring[record.agent] == record {
			delete(s.retiring, record.agent)
		}
		s.retireErr = errors.Join(s.retireErr, result)
		if current := s.sessions[record.agent.ID()]; current == nil || current == record {
			s.closedSessions[record.agent.ID()] = record
		}
		s.mu.Unlock()
		record.mu.Lock()
		record.closeErr = result
		close(record.closeDone)
		record.mu.Unlock()
	}()
}

func waitRecordClose(ctx context.Context, record *activeSession) error {
	select {
	case <-record.closeDone:
	case <-ctx.Done():
		return ctx.Err()
	}
	record.mu.Lock()
	defer record.mu.Unlock()
	return record.closeErr
}

// Called by the manager after the exact worker stops and preparation publishes
// its resource closures. The writer remains attached through admitted commands.
func (s *Server) finishSession(record *activeSession) (result error) {
	record.mu.Lock()
	if record.cleanupDone != nil {
		done := record.cleanupDone
		select {
		case <-done:
			result = record.cleanupErr
		default:
			result = harness.ErrAgentDisposalInProgress
		}
		record.mu.Unlock()
		return result
	}
	record.cleanupDone = make(chan struct{})
	record.closing = true
	idle := record.commandsIdle
	record.mu.Unlock()
	defer func() {
		result = withoutServerClosePending(result)
		record.mu.Lock()
		record.cleanupErr = result
		close(record.cleanupDone)
		record.mu.Unlock()
	}()
	<-idle
	if record.detachEvent != nil {
		result = errors.Join(result, invokeCleanup(func() error { record.detachEvent(); return nil }))
	}
	if record.detachStore != nil {
		result = errors.Join(result, invokeCleanup(record.detachStore))
	}
	return result
}

func invokeCleanup(callback func() error) (err error) {
	defer func() {
		if value := recover(); value != nil {
			err = fmt.Errorf("acp: cleanup panic: %v", value)
		}
	}()
	return callback()
}

func (s *Server) currentRecord(id harness.SessionID) (*activeSession, error) {
	s.mu.Lock()
	record, closing := s.sessions[id], s.closing
	s.mu.Unlock()
	if closing {
		return nil, errors.New("acp: server is closing")
	}
	if record == nil {
		return nil, invalidError("unknown session: " + string(id))
	}
	current, live := s.h.Agents().Get(id)
	if !live || current != record.agent {
		return nil, invalidError("session is no longer active: " + string(id))
	}
	record.mu.Lock()
	closing = record.closing
	record.mu.Unlock()
	if closing {
		return nil, invalidError("session is closing: " + string(id))
	}
	return record, nil
}

func withoutServerClosePending(err error) error {
	if err == ErrServerCloseInProgress {
		return nil
	}
	if group, ok := err.(interface{ Unwrap() []error }); ok {
		var joined error
		for _, part := range group.Unwrap() {
			joined = errors.Join(joined, withoutServerClosePending(part))
		}
		return joined
	}
	if wrapper, ok := err.(interface{ Unwrap() error }); ok {
		filtered := withoutServerClosePending(wrapper.Unwrap())
		if filtered == nil {
			return nil
		}
		return fmt.Errorf("%s: %w", err.Error(), filtered)
	}
	return err
}
