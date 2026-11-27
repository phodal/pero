package team

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/phodal/pero/harness/go/harness"
)

func fold(root harness.SessionID, events []harness.Event) (state, error) {
	board := state{tasks: []Task{}}
	for _, event := range events {
		if event.Type != eventType {
			continue
		}
		var c change
		if err := json.Unmarshal(event.Data, &c); err != nil {
			return state{}, fmt.Errorf("team: malformed journal at %d: %w", event.Seq, err)
		}
		// Public forks may copy history but never inherit board authority.
		if c.Root == root {
			if err := board.apply(c); err != nil {
				return state{}, err
			}
		}
	}
	return board, nil
}

// Board binds operations to the registry that owns the caller's current tree.
// Creating it does not opt any session into Team mode or mount any model tool.
type Board struct {
	Registry *harness.SubagentRegistry
}

func (b Board) root(caller *harness.Agent) (*harness.Agent, error) {
	if b.Registry == nil {
		return nil, ErrDisabled
	}
	root, err := b.Registry.LiveTreeRoot(caller)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrForbidden, err)
	}
	if !root.Session().DurabilityAttached() || root.IsExternal() {
		return nil, ErrDisabled
	}
	return root, nil
}

func (b Board) SetEnabled(ctx context.Context, caller *harness.Agent, enabled bool) error {
	_, err := b.commit(ctx, caller, func(s state, caller, root harness.SessionID) (change, error) {
		if caller != root {
			return change{}, ErrForbidden
		}
		if s.enabled == enabled {
			return change{}, nil
		}
		return change{Mode: &enabled}, nil
	})
	return err
}

func (b Board) List(caller *harness.Agent) ([]Task, error) {
	root, err := b.root(caller)
	if err != nil {
		return nil, err
	}
	s, err := fold(root.ID(), root.Session().Events())
	if err != nil {
		return nil, err
	}
	if !s.enabled {
		return nil, ErrDisabled
	}
	return s.tasks, nil
}

func (b Board) Create(ctx context.Context, caller *harness.Agent, input NewTask) (Task, error) {
	return b.commit(ctx, caller, func(s state, _, _ harness.SessionID) (change, error) {
		if !s.enabled {
			return change{}, ErrDisabled
		}
		task, err := s.create(input)
		return change{Task: &task}, err
	})
}

func (b Board) Update(ctx context.Context, caller *harness.Agent, ref TaskRef, operation Update) (Task, error) {
	return b.commit(ctx, caller, func(s state, actor, root harness.SessionID) (change, error) {
		if !s.enabled {
			return change{}, ErrDisabled
		}
		task, err := s.update(ref, operation, actor, root)
		return change{Task: &task}, err
	})
}

func (b Board) commit(ctx context.Context, caller *harness.Agent, apply func(state, harness.SessionID, harness.SessionID) (change, error)) (Task, error) {
	for {
		if err := ctx.Err(); err != nil {
			return Task{}, err
		}
		root, err := b.root(caller)
		if err != nil {
			return Task{}, err
		}
		session := root.Session()
		events := session.Events()
		board, err := fold(root.ID(), events)
		if err != nil {
			return Task{}, err
		}
		next, err := apply(board, caller.ID(), root.ID())
		if err != nil {
			return Task{}, err
		}
		var task Task
		if next.Task != nil {
			task = *next.Task
		}
		if next.Mode != nil || next.Task != nil {
			if err := ctx.Err(); err != nil {
				return Task{}, err
			}
			next.Root = root.ID()
			var tail uint64
			if len(events) != 0 {
				tail = events[len(events)-1].Seq
			}
			if _, err := session.AppendIfLastSeq(tail, eventType, next); errors.Is(err, harness.ErrSessionChanged) {
				continue
			} else if err != nil {
				return Task{}, err
			}
		}
		if err := session.Flush(ctx); err != nil {
			return task, fmt.Errorf("team: change in memory but durability failed; inspect before retrying: %w", err)
		}
		return task, nil
	}
}
