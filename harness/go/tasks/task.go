// Package tasks owns the durable per-session Claude task table. It is separate
// from todo_write and from subagent execution handles.
package tasks

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

type TaskID string
type TaskStatus string

const (
	Pending    TaskStatus = "pending"
	InProgress TaskStatus = "in_progress"
	Completed  TaskStatus = "completed"
	Deleted    TaskStatus = "deleted"
	MaxTasks              = 512
)

type Task struct {
	ID          TaskID     `json:"id"`
	Subject     string     `json:"subject"`
	Description string     `json:"description"`
	ActiveForm  string     `json:"activeForm,omitempty"`
	Status      TaskStatus `json:"status"`
	Owner       string     `json:"owner,omitempty"`
	BlockedBy   []TaskID   `json:"blockedBy"`
	Metadata    Metadata   `json:"metadata"`
}

// Blocks is derived from the graph's single canonical BlockedBy representation.
type TaskView struct {
	Task
	Blocks []TaskID `json:"blocks"`
}

type NewTask struct {
	Subject     string   `json:"subject"`
	Description string   `json:"description"`
	ActiveForm  string   `json:"activeForm,omitempty"`
	Metadata    Metadata `json:"metadata,omitempty"`
}

type Update struct {
	TaskID       TaskID      `json:"taskId"`
	Subject      *string     `json:"subject,omitempty"`
	Description  *string     `json:"description,omitempty"`
	ActiveForm   *string     `json:"activeForm,omitempty"`
	Status       *TaskStatus `json:"status,omitempty"`
	Owner        *string     `json:"owner,omitempty"`
	Metadata     Metadata    `json:"metadata,omitempty"`
	AddBlockedBy []TaskID    `json:"addBlockedBy,omitempty"`
	AddBlocks    []TaskID    `json:"addBlocks,omitempty"`
}

type Command struct {
	Create *NewTask `json:"create,omitempty"`
	Update *Update  `json:"update,omitempty"`
}

const EventType = "tasks/change"

type Change struct {
	Version int     `json:"version"`
	Command Command `json:"command"`
}

// Completion is emitted only for a transition into completed. Hook wiring can
// consume the proposed transition before its Change is committed by the shell.
type Completion struct {
	TaskID  TaskID
	Subject string
}

type Transition struct {
	Change     Change
	Task       TaskView
	Completion *Completion
}

type State struct {
	tasks  []Task
	nextID uint64
}

var ErrTaskNotFound = errors.New("task does not exist or was deleted")

// Fold is a pure replay of versioned domain changes. Other session records
// never enter this function, and turn boundaries do not reset the task table.
func Fold(changes []Change) (State, error) {
	var state State
	for i, change := range changes {
		if change.Version != 1 {
			return State{}, fmt.Errorf("tasks: unsupported change version at record %d", i+1)
		}
		next, _, err := Apply(state, change.Command)
		if err != nil {
			return State{}, fmt.Errorf("tasks: invalid change at record %d: %w", i+1, err)
		}
		state = next
	}
	return state, nil
}

// Apply is the sole owner of task status, identity, metadata and graph rules.
// Returned values are detached; neither the previous state nor command changes.
func Apply(previous State, command Command) (State, Transition, error) {
	if (command.Create == nil) == (command.Update == nil) {
		return State{}, Transition{}, errors.New("tasks: exactly one create or update operation is required")
	}
	command = cloneCommand(command)
	state := State{tasks: make([]Task, len(previous.tasks)), nextID: previous.nextID}
	for i, task := range previous.tasks {
		state.tasks[i] = cloneTask(task)
	}
	if state.nextID == 0 {
		state.nextID = 1
	}
	var selected int
	var wasCompleted bool
	if input := command.Create; input != nil {
		if len(state.tasks) >= MaxTasks {
			return State{}, Transition{}, errors.New("tasks: session task limit reached")
		}
		if err := validateText(input.Subject, input.Description, input.ActiveForm); err != nil {
			return State{}, Transition{}, err
		}
		metadata, err := mergeMetadata(nil, input.Metadata)
		if err != nil {
			return State{}, Transition{}, err
		}
		selected = len(state.tasks)
		state.tasks = append(state.tasks, Task{ID: TaskID(strconv.FormatUint(state.nextID, 10)), Subject: strings.TrimSpace(input.Subject), Description: input.Description, ActiveForm: input.ActiveForm, Status: Pending, BlockedBy: []TaskID{}, Metadata: metadata})
		state.nextID++
	} else {
		input := command.Update
		selected = state.index(input.TaskID)
		if selected < 0 {
			return State{}, Transition{}, fmt.Errorf("tasks: %q: %w", input.TaskID, ErrTaskNotFound)
		}
		task := &state.tasks[selected]
		wasCompleted = task.Status == Completed
		if input.Subject != nil {
			task.Subject = strings.TrimSpace(*input.Subject)
		}
		if input.Description != nil {
			task.Description = *input.Description
		}
		if input.ActiveForm != nil {
			task.ActiveForm = *input.ActiveForm
		}
		if input.Owner != nil {
			if len(*input.Owner) > 512 {
				return State{}, Transition{}, errors.New("tasks: owner must not exceed 512 bytes")
			}
			task.Owner = *input.Owner
		}
		if input.Status != nil {
			switch *input.Status {
			case Pending, InProgress, Completed, Deleted:
				task.Status = *input.Status
			default:
				return State{}, Transition{}, errors.New("tasks: status must be pending, in_progress, completed or deleted")
			}
		}
		if err := validateText(task.Subject, task.Description, task.ActiveForm); err != nil {
			return State{}, Transition{}, err
		}
		metadata, err := mergeMetadata(task.Metadata, input.Metadata)
		if err != nil {
			return State{}, Transition{}, err
		}
		task.Metadata = metadata
		for _, id := range input.AddBlockedBy {
			if err := state.addDependency(selected, id); err != nil {
				return State{}, Transition{}, err
			}
		}
		for _, id := range input.AddBlocks {
			other := state.index(id)
			if other < 0 {
				return State{}, Transition{}, fmt.Errorf("tasks: dependency %q: %w", id, ErrTaskNotFound)
			}
			if err := state.addDependency(other, input.TaskID); err != nil {
				return State{}, Transition{}, err
			}
		}
		if task.Status == Deleted {
			// Deleted IDs remain reserved, while deletion releases their edges.
			task.BlockedBy = []TaskID{}
			for i := range state.tasks {
				var remaining []TaskID
				for _, id := range state.tasks[i].BlockedBy {
					if id != task.ID {
						remaining = append(remaining, id)
					}
				}
				state.tasks[i].BlockedBy = append([]TaskID{}, remaining...)
			}
		}
		if state.hasCycle() {
			return State{}, Transition{}, errors.New("tasks: dependency would create a cycle")
		}
	}
	view := state.view(selected)
	transition := Transition{Change: Change{Version: 1, Command: command}, Task: view}
	if view.Status == Completed && !wasCompleted {
		transition.Completion = &Completion{TaskID: view.ID, Subject: view.Subject}
	}
	return state, transition, nil
}

func (s State) Get(id TaskID) (TaskView, error) {
	i := s.index(id)
	if i < 0 {
		return TaskView{}, fmt.Errorf("tasks: %q: %w", id, ErrTaskNotFound)
	}
	return s.view(i), nil
}
func (s State) List() []TaskView {
	result := []TaskView{}
	for i, task := range s.tasks {
		if task.Status != Deleted {
			result = append(result, s.view(i))
		}
	}
	return result
}

func (s State) index(id TaskID) int {
	for i, task := range s.tasks {
		if task.ID == id && task.Status != Deleted {
			return i
		}
	}
	return -1
}
func (s State) view(i int) TaskView {
	task := cloneTask(s.tasks[i])
	// The canonical graph retains prerequisites, while the model-facing view
	// lists only outstanding blockers. Completing a prerequisite releases work
	// without losing dependency history or requiring another mutable index.
	task.BlockedBy = []TaskID{}
	if task.Status != Completed && task.Status != Deleted {
		for _, id := range s.tasks[i].BlockedBy {
			dependency := s.index(id)
			if dependency >= 0 && s.tasks[dependency].Status != Completed {
				task.BlockedBy = append(task.BlockedBy, id)
			}
		}
	}
	blocks := []TaskID{}
	for _, other := range s.tasks {
		if task.Status == Completed || task.Status == Deleted || other.Status == Deleted || other.Status == Completed {
			continue
		}
		for _, id := range other.BlockedBy {
			if id == task.ID {
				blocks = append(blocks, other.ID)
				break
			}
		}
	}
	return TaskView{Task: task, Blocks: blocks}
}
func (s *State) addDependency(selected int, dependency TaskID) error {
	task := &s.tasks[selected]
	if task.ID == dependency {
		return errors.New("tasks: a task cannot depend on itself")
	}
	if s.index(dependency) < 0 {
		return fmt.Errorf("tasks: dependency %q: %w", dependency, ErrTaskNotFound)
	}
	for _, id := range task.BlockedBy {
		if id == dependency {
			return nil
		}
	}
	task.BlockedBy = append(task.BlockedBy, dependency)
	return nil
}
func (s State) hasCycle() bool {
	const visiting, visited = 1, 2
	marks := make(map[TaskID]int)
	var visit func(TaskID) bool
	visit = func(id TaskID) bool {
		if marks[id] == visiting {
			return true
		}
		if marks[id] == visited {
			return false
		}
		marks[id] = visiting
		i := s.index(id)
		if i >= 0 {
			for _, dependency := range s.tasks[i].BlockedBy {
				if visit(dependency) {
					return true
				}
			}
		}
		marks[id] = visited
		return false
	}
	for _, task := range s.tasks {
		if task.Status != Deleted && visit(task.ID) {
			return true
		}
	}
	return false
}
func validateText(subject, description, activeForm string) error {
	if strings.TrimSpace(subject) == "" || len(subject) > 512 {
		return errors.New("tasks: subject must be nonempty and at most 512 bytes")
	}
	if len(description) > 16384 || len(activeForm) > 512 {
		return errors.New("tasks: description must be at most 16384 bytes and activeForm at most 512 bytes")
	}
	return nil
}
func cloneTask(task Task) Task {
	task.BlockedBy = append([]TaskID{}, task.BlockedBy...)
	task.Metadata = append(Metadata{}, task.Metadata...)
	return task
}
func copyValue[T any](value *T) *T {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}
func cloneCommand(command Command) Command {
	if command.Create != nil {
		value := *command.Create
		value.Metadata = append(Metadata{}, value.Metadata...)
		command.Create = &value
	}
	if command.Update != nil {
		value := *command.Update
		value.Subject = copyValue(value.Subject)
		value.Description = copyValue(value.Description)
		value.ActiveForm = copyValue(value.ActiveForm)
		value.Owner = copyValue(value.Owner)
		value.Status = copyValue(value.Status)
		value.Metadata = append(Metadata{}, value.Metadata...)
		value.AddBlockedBy = append([]TaskID{}, value.AddBlockedBy...)
		value.AddBlocks = append([]TaskID{}, value.AddBlocks...)
		command.Update = &value
	}
	return command
}
