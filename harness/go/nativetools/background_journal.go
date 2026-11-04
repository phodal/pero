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
	intent     shellTaskIntent
	terminal   *shellTaskTerminal
	promotion  *shellTaskPromotion
	startedSeq uint64
	settledSeq uint64
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
			if intent.Version != 1 || !strings.HasPrefix(intent.ID, "bash-") || intent.Owner == "" || intent.Command == "" || intent.Workdir == "" || intent.TimeoutMS < 0 || intent.TimeoutMS == 0 && !intent.NoDeadline {
				return nil, errors.New("shell task journal contains an invalid intent")
			}
			if intent.TerminateOnTimeout && intent.Background {
				return nil, errors.New("bounded foreground check cannot have a background intent")
			}
			if intent.HostMode != "" && intent.HostMode != BashUnattended && intent.HostMode != BashInteractive || intent.NoDeadline && (!intent.Background || intent.HostMode != BashInteractive || intent.TimeoutMS != 0) {
				return nil, errors.New("shell task journal contains an invalid host deadline policy")
			}
			if intent.Owner != owner {
				continue
			}
			if _, exists := tasks[intent.ID]; exists {
				return nil, errors.New("shell task journal repeats a task identity")
			}
			tasks[intent.ID] = shellTaskHistory{intent: intent, startedSeq: event.Seq}
		case shellTaskPromoted:
			var promotion shellTaskPromotion
			decoder := json.NewDecoder(bytes.NewReader(event.Data))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&promotion); err != nil {
				return nil, fmt.Errorf("shell task promotion at sequence %d: %w", event.Seq, err)
			}
			if promotion.Version != 1 || promotion.Owner == "" || promotion.TimeoutMS < 0 || promotion.TimeoutMS == 0 && !promotion.NoDeadline || promotion.NoDeadline && promotion.TimeoutMS != 0 {
				return nil, errors.New("shell task journal contains an invalid promotion")
			}
			if promotion.Owner != owner {
				continue
			}
			previous, exists := tasks[promotion.ID]
			if !exists || previous.intent.Background || previous.intent.TerminateOnTimeout || previous.terminal != nil || previous.promotion != nil || promotion.NoDeadline && previous.intent.HostMode != BashInteractive {
				return nil, errors.New("shell task promotion lacks one unfinished foreground intent")
			}
			previous.promotion = &promotion
			tasks[promotion.ID] = previous
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
			if terminal.Presentation != nil && terminal.Presentation.OutputFile != "" && terminal.Status != shellTaskCompleted {
				return nil, errors.New("failed shell task advertises a success artifact")
			}
			previous.terminal = &terminal
			previous.settledSeq = event.Seq
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
	if stored.terminal.Presentation != nil && stored.terminal.Presentation.OutputFile != "" {
		plan, err := shell.PlanOutputFile(s.options.CWD, ".pero/bash-artifacts", stored.intent.ID+".txt", bashArtifactBytes)
		if err != nil {
			return harness.TaskHandle{}, false, err
		}
		if plan.Path() != stored.terminal.Presentation.OutputFile {
			return harness.TaskHandle{}, false, errors.New("Bash artifact reference is outside its configured destination")
		}
		exists, err := plan.Exists()
		if err != nil {
			return harness.TaskHandle{}, false, err
		}
		if !exists {
			copy := *stored.terminal
			presentation := *copy.Presentation
			presentation.OutputFile, presentation.OutputFileBytes = "", 0
			copy.Presentation = &presentation
			copy.Diagnostic += "; saved Bash artifact is unavailable; inspect working_log_file"
			stored.terminal = &copy
		}
	}
	task = &shellTask{parent: parent, intent: stored.intent, terminal: stored.terminal, terminalPersisted: true, promotion: stored.promotion, done: make(chan struct{})}
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
