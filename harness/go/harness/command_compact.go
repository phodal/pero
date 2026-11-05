package harness

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	point "github.com/phodal/pero/harness/go/runtime"
)

const compactCommandUsage = "Usage: /compact [instructions]"

func CompactCommandDefinition() CommandDefinition {
	return CommandDefinition{
		Name: "compact", Description: "Compact older conversation history",
		Handler: func(ctx context.Context, invocation CommandInvocation) (CommandResult, error) {
			result, err := invocation.Agent.CompactWithInstructions(ctx, strings.TrimSpace(invocation.RawInput), invocation.CommandID)
			if err != nil {
				if commandContextFailure(ctx) != nil {
					return CommandResult{}, err
				}
				var expected *ManualCompactionError
				if !errors.As(err, &expected) {
					return CommandResult{}, err
				}
				return CommandResult{Kind: CommandError, Text: renderManualCompactionFailure(expected.Code)}, nil
			}
			if result == nil {
				return CommandResult{Kind: CommandSuccess, Text: "No compactable history yet."}, nil
			}
			return CommandResult{
				Kind: CommandSuccess,
				Text: fmt.Sprintf(
					"Compacted %d history items (~%d tokens).",
					len(result.ShadowedSeqs),
					result.ShadowedTokenCount,
				),
				SourceEventSeq: result.SummarySeq,
			}, nil
		},
	}
}

func (h *Harness) RegisterCompactCommand(ctx context.Context) (*point.Instance, error) {
	definition := point.Define(
		point.Descriptor{ID: "harness/contribution/command/compact", Requires: []point.Requirement{point.Require(CommandRegistryKey)}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			registry, err := point.Resolve(run, CommandRegistryKey)
			if err != nil {
				return nil, err
			}
			drain := newCommandHandlerDrain()
			command := CompactCommandDefinition()
			handler := command.Handler
			command.Handler = drain.wrap(handler)
			// Register the drain before the command. Point teardown is LIFO, so
			// discovery closes first and already-started handlers quiesce second.
			if err := run.Defer("command-compact:drain", drain.wait); err != nil {
				return nil, err
			}
			if _, err := registry.Register(run, command); err != nil {
				return nil, err
			}
			return nil, nil
		},
	)
	instance, err := h.runtime.Mount(nil, "harness/command/compact", definition, nil)
	if err != nil {
		return nil, err
	}
	if err := instance.WaitStable(ctx); err != nil {
		_ = instance.Dispose(context.Background())
		return nil, err
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		_ = instance.Dispose(context.Background())
		return nil, fmt.Errorf("harness: register compact command: %s", snapshot.LastError)
	}
	return instance, nil
}

type commandHandlerDrain struct {
	mu      sync.Mutex
	closing bool
	active  int
	idle    chan struct{}
}

func newCommandHandlerDrain() *commandHandlerDrain {
	idle := make(chan struct{})
	close(idle)
	return &commandHandlerDrain{idle: idle}
}

func (d *commandHandlerDrain) wrap(handler CommandHandler) CommandHandler {
	return func(ctx context.Context, invocation CommandInvocation) (CommandResult, error) {
		if !d.begin() {
			return CommandResult{}, errors.New("harness: compact command is disposing")
		}
		defer d.finish()
		return handler(ctx, invocation)
	}
}

func (d *commandHandlerDrain) begin() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.closing {
		return false
	}
	if d.active == 0 {
		d.idle = make(chan struct{})
	}
	d.active++
	return true
}

func (d *commandHandlerDrain) finish() {
	d.mu.Lock()
	d.active--
	if d.active == 0 {
		close(d.idle)
	}
	d.mu.Unlock()
}

func (d *commandHandlerDrain) wait(ctx context.Context) error {
	d.mu.Lock()
	d.closing = true
	idle := d.idle
	d.mu.Unlock()
	select {
	case <-idle:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func renderManualCompactionFailure(code ManualCompactionErrorCode) string {
	switch code {
	case ManualCompactionBusy:
		return "Compaction is unavailable because this process has an active compaction, or the agent is not idle."
	case ManualCompactionCancelled:
		return "Compaction cancelled."
	case ManualCompactionChanged:
		return "The history selected for compaction changed before it could be replaced. The conversation is unchanged; the attempt is recorded in the session log."
	case ManualCompactionSummary:
		return "Compaction could not produce a useful summary. The conversation is unchanged; the attempt is recorded in the session log."
	case ManualCompactionCommit:
		return "Compaction did not finish cleanly; some session history may have changed. Inspect the current session state before retrying."
	case ManualCompactionPersistence:
		return "Compaction finished, but the session could not be saved."
	default:
		return "Compaction failed."
	}
}
