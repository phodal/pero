package nativetools

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/shell"
)

type shellTaskHistory struct {
	intent   shellTaskIntent
	terminal *shellTaskTerminal
}

func foldShellTasks(events []harness.Event, owner harness.SessionID) (map[string]shellTaskHistory, error) {
	tasks := make(map[string]shellTaskHistory)
	for _, event := range events {
		switch event.Type {
		case shellTaskStarted:
			intent := shellTaskIntent{Background: true}
			decoder := json.NewDecoder(bytes.NewReader(event.Data))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&intent); err != nil {
				return nil, fmt.Errorf("shell task intent at sequence %d: %w", event.Seq, err)
			}
			if intent.Version != 1 || !strings.HasPrefix(intent.ID, "bash-") || intent.Owner == "" || intent.Command == "" || intent.Workdir == "" || intent.TimeoutMS <= 0 {
				return nil, errors.New("shell task journal contains an invalid intent")
			}
			if intent.Owner != owner {
				continue
			}
			if _, exists := tasks[intent.ID]; exists {
				return nil, errors.New("shell task journal repeats a task identity")
			}
			tasks[intent.ID] = shellTaskHistory{intent: intent}
		case shellTaskEnded:
			var terminal shellTaskTerminal
			decoder := json.NewDecoder(bytes.NewReader(event.Data))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&terminal); err != nil {
				return nil, fmt.Errorf("shell task terminal at sequence %d: %w", event.Seq, err)
			}
			if terminal.Version != 1 || terminal.Owner == "" {
				return nil, errors.New("shell task journal contains an invalid terminal fact")
			}
			if terminal.Owner != owner {
				continue
			}
			previous, exists := tasks[terminal.ID]
			if !exists || previous.terminal != nil {
				return nil, errors.New("shell task terminal lacks one unfinished intent")
			}
			switch terminal.Status {
			case "completed", "failed", "stopped", "interrupted":
			default:
				return nil, errors.New("shell task journal contains an unknown terminal status")
			}
			if terminal.Status == shellTaskCompleted && (terminal.Result == nil || terminal.Result.ExitCode == nil) {
				return nil, errors.New("completed shell task lacks its actual exit result")
			}
			if terminal.OutputFile != "" && terminal.OutputFile != previous.intent.OutputFile {
				return nil, errors.New("shell task terminal changed its output destination")
			}
			if terminal.Result != nil && terminal.Result.OutputFile != "" && terminal.Result.OutputFile != terminal.OutputFile {
				return nil, errors.New("shell task result changed its output destination")
			}
			previous.terminal = &terminal
			tasks[terminal.ID] = previous
		}
	}
	return tasks, nil
}

// LookupTask returns only this exact parent's live shell tasks or its own
// durable receipts. A missing process owner becomes interrupted, never replayed.
func (a *App) LookupTask(ctx context.Context, parent *harness.Agent, id string) (harness.TaskHandle, bool, error) {
	if a == nil || a.background == nil || parent == nil || !strings.HasPrefix(id, "bash-") {
		return harness.TaskHandle{}, false, nil
	}
	return a.background.lookup(ctx, parent, id)
}

func (s *shellTasks) lookup(ctx context.Context, parent *harness.Agent, id string) (harness.TaskHandle, bool, error) {
	s.mu.Lock()
	task := s.tasks[id]
	s.mu.Unlock()
	if task != nil && task.parent == parent {
		return task.handle(), true, nil
	}
	s.recovery.Lock()
	defer s.recovery.Unlock()
	history, err := foldShellTasks(parent.Session().Events(), parent.ID())
	if err != nil {
		return harness.TaskHandle{}, false, err
	}
	stored, found := history[id]
	if !found {
		return harness.TaskHandle{}, false, nil
	}
	outputFile, err := s.recoveredOutputFile(stored.intent)
	if err != nil {
		return harness.TaskHandle{}, false, err
	}
	if stored.terminal == nil {
		terminal := shellTaskTerminal{Version: 1, ID: id, Owner: parent.ID(), Status: "interrupted", Diagnostic: "The process owner is unavailable after restart; the command was not replayed. Inspect workspace side effects before retrying.", OutputFile: outputFile, OutputFilePartial: outputFile != ""}
		if _, err := parent.Session().Append(shellTaskEnded, terminal); err != nil {
			return harness.TaskHandle{}, false, err
		}
		if err := parent.Session().Flush(ctx); err != nil {
			return harness.TaskHandle{}, false, fmt.Errorf("persist interrupted shell task: %w", err)
		}
		stored.terminal = &terminal
	}
	if stored.terminal.OutputFile != "" && outputFile == "" {
		copy := *stored.terminal
		copy.OutputFile = ""
		copy.Diagnostic += "; saved output file is unavailable"
		if copy.Result != nil {
			result := *copy.Result
			result.OutputFile = ""
			copy.Result = &result
		}
		stored.terminal = &copy
	}
	task = &shellTask{parent: parent, intent: stored.intent, terminal: stored.terminal, done: make(chan struct{})}
	close(task.done)
	s.mu.Lock()
	s.tasks[id] = task
	s.mu.Unlock()
	return task.handle(), true, nil
}

func (s *shellTasks) recoveredOutputFile(intent shellTaskIntent) (string, error) {
	if intent.OutputFile == "" {
		return "", nil
	}
	plan, err := shell.PlanOutputFile(s.options.CWD, ".pero/bash-output", intent.ID+".log", 0)
	if err != nil {
		return "", err
	}
	if plan.Path() != intent.OutputFile {
		return "", errors.New("shell task output reference is outside its configured destination")
	}
	exists, err := plan.Exists()
	if err != nil || !exists {
		return "", err
	}
	return plan.Path(), nil
}
