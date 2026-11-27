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
	_, err := b.commit(ctx, caller, func(s state, root *harness.Agent) (change, error) {
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
	s, err := b.read(caller)
	if err != nil {
		return nil, err
	}
	return s.list(), nil
}

func (b Board) read(caller *harness.Agent) (state, error) {
	_, s, err := b.readRoot(caller)
	return s, err
}

func (b Board) readRoot(caller *harness.Agent) (*harness.Agent, state, error) {
	root, err := b.root(caller)
	if err != nil {
		return nil, state{}, err
	}
	s, err := fold(root.ID(), root.Session().Events())
	if err != nil {
		return nil, state{}, err
	}
	if !s.enabled {
		return nil, state{}, ErrDisabled
	}
	return root, s, nil
}

func (b Board) Create(ctx context.Context, caller *harness.Agent, input NewTask) (TaskView, error) {
	return b.commit(ctx, caller, func(s state, _ *harness.Agent) (change, error) {
		if !s.enabled {
			return change{}, ErrDisabled
		}
		task, err := s.create(input)
		return change{Task: &task}, err
	})
}

func (b Board) Update(ctx context.Context, caller *harness.Agent, ref TaskRef, operation Update) (TaskView, error) {
	return b.update(ctx, caller, ref, mutation{operation: operation})
}

func (b Board) update(ctx context.Context, caller *harness.Agent, ref TaskRef, input mutation) (TaskView, error) {
	return b.commit(ctx, caller, func(s state, root *harness.Agent) (change, error) {
		if !s.enabled {
			return change{}, ErrDisabled
		}
		task, err := s.update(ref, input, caller.ID(), root.ID())
		return change{Task: &task}, err
	})
}

// Reassign changes the saved owner only; resolving a member never resumes it
// or submits a message. An empty target releases the task back to pending.
func (b Board) Reassign(ctx context.Context, caller *harness.Agent, ref TaskRef, target harness.SessionID) (TaskView, error) {
	return b.commit(ctx, caller, func(s state, root *harness.Agent) (change, error) {
		if !s.enabled {
			return change{}, ErrDisabled
		}
		assignee := target
		if assignee == "lead" {
			assignee = root.ID()
		}
		task, err := s.reassign(ref, assignee, caller == root)
		if err != nil {
			return change{}, err
		}
		if assignee != "" && assignee != root.ID() {
			ok, err := b.Registry.IsContinuableDescendant(ctx, root, assignee)
			if err != nil {
				return change{}, err
			}
			if !ok {
				return change{}, fmt.Errorf("%w: %q", ErrMemberNotFound, assignee)
			}
		}
		return change{Task: &task}, nil
	})
}

func (b Board) commit(ctx context.Context, caller *harness.Agent, apply func(state, *harness.Agent) (change, error)) (TaskView, error) {
	for {
		if err := ctx.Err(); err != nil {
			return TaskView{}, err
		}
		root, err := b.root(caller)
		if err != nil {
			return TaskView{}, err
		}
		session := root.Session()
		events := session.Events()
		board, err := fold(root.ID(), events)
		if err != nil {
			return TaskView{}, err
		}
		next, err := apply(board, root)
		if err != nil {
			return TaskView{}, err
		}
		if next.Mode != nil || next.Task != nil {
			if err := ctx.Err(); err != nil {
				return TaskView{}, err
			}
			// Assignee discovery may have read durable storage while the caller
			// was closing. Recheck exact runtime ownership before publication.
			if current, err := b.root(caller); err != nil || current != root {
				if err != nil {
					return TaskView{}, err
				}
				return TaskView{}, ErrForbidden
			}
			next.Root = root.ID()
			var tail uint64
			if len(events) != 0 {
				tail = events[len(events)-1].Seq
			}
			if _, err := session.AppendIfLastSeq(tail, eventType, next); errors.Is(err, harness.ErrSessionChanged) {
				continue
			} else if err != nil {
				return TaskView{}, err
			}
		}
		// The append validated this exact board snapshot. Project the newly
		// committed task against it, not a later read that might include
		// another caller's changes. Readiness and warnings depend on peers.
		var view TaskView
		if next.Task != nil {
			view = board.view(*next.Task)
		}
		if err := session.Flush(ctx); err != nil {
			return view, fmt.Errorf("team: change in memory but durability failed; inspect before retrying: %w", err)
		}
		return view, nil
	}
}
