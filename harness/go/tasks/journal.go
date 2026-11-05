package tasks

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/phodal/pero/harness/go/harness"
)

// Current reconstructs tasks from the authoritative journal without a second
// state store. Ordinary turns and compaction do not erase log-only task facts.
func Current(session *harness.Session) (State, error) {
	if session == nil {
		return State{}, errors.New("tasks: an owning session is required")
	}
	return foldEvents(session.Events())
}

func foldEvents(events []harness.Event) (State, error) {
	changes := []Change{}
	for _, event := range events {
		if event.Type != EventType {
			continue
		}
		var change Change
		decoder := json.NewDecoder(bytes.NewReader(event.Data))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&change); err != nil {
			return State{}, fmt.Errorf("tasks: malformed change at session sequence %d: %w", event.Seq, err)
		}
		changes = append(changes, change)
	}
	return Fold(changes)
}

// Commit retries only a journal compare-and-swap miss. The same domain command
// is reapplied to the fresh state, so IDs and graph updates cannot be lost.
func Commit(ctx context.Context, session *harness.Session, command Command) (Transition, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if session == nil {
		return Transition{}, errors.New("tasks: an owning session is required")
	}
	for {
		if err := ctx.Err(); err != nil {
			return Transition{}, err
		}
		events := session.Events()
		state, err := foldEvents(events)
		if err != nil {
			return Transition{}, err
		}
		_, transition, err := Apply(state, command)
		if err != nil {
			return Transition{}, err
		}
		var lastSeq uint64
		if len(events) > 0 {
			lastSeq = events[len(events)-1].Seq
		}
		if _, err = session.AppendIfLastSeq(lastSeq, EventType, transition.Change); errors.Is(err, harness.ErrSessionChanged) {
			continue
		} else if err != nil {
			return Transition{}, err
		}
		if err := session.Flush(ctx); err != nil {
			return transition, fmt.Errorf("tasks: change committed but durability failed; inspect the task before retrying: %w", err)
		}
		return transition, nil
	}
}
