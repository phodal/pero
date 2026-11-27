// Package team provides shared task ownership for a live native subagent tree.
// Claude's session-local task journal is deliberately separate.
package team

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
)

const (
	eventType = "pero/team/board"
	taskLimit = 256
)

var (
	ErrDisabled   = errors.New("TEAM_DISABLED")
	ErrForbidden  = errors.New("TEAM_TASK_UNAUTHORIZED")
	ErrNotFound   = errors.New("TEAM_TASK_NOT_FOUND")
	ErrStale      = errors.New("TEAM_TASK_STALE_REVISION")
	ErrBlocked    = errors.New("TEAM_TASK_BLOCKED")
	ErrClaimed    = errors.New("TEAM_TASK_ALREADY_CLAIMED")
	ErrTransition = errors.New("TEAM_TASK_INVALID_TRANSITION")
	ErrLimit      = errors.New("TEAM_TASK_LIMIT")
)

type TaskID uint32

// Task IDs are opaque decimal strings on the tool and journal boundaries.
func (id TaskID) MarshalJSON() ([]byte, error) {
	return strconv.AppendQuote(nil, strconv.FormatUint(uint64(id), 10)), nil
}

func (id *TaskID) UnmarshalJSON(data []byte) error {
	raw, err := strconv.Unquote(string(data))
	if err != nil {
		return err
	}
	*id, err = parseTaskID(raw)
	return err
}

func parseTaskID(raw string) (TaskID, error) {
	id, err := strconv.ParseUint(raw, 10, 32)
	if err != nil || id == 0 || strconv.FormatUint(id, 10) != raw {
		return 0, fmt.Errorf("%w: invalid id", ErrNotFound)
	}
	return TaskID(id), nil
}

type Status string

const (
	Pending    Status = "pending"
	InProgress Status = "in_progress"
	Completed  Status = "completed"
)

type Task struct {
	ID           TaskID            `json:"id"`
	Title        string            `json:"subject"`
	Details      string            `json:"description,omitempty"`
	Dependencies []TaskID          `json:"blockedBy,omitempty"`
	Revision     uint64            `json:"revision"`
	Status       Status            `json:"status"`
	Owner        harness.SessionID `json:"owner,omitempty"`
}

type NewTask struct {
	Title        string
	Details      string
	Dependencies []TaskID
}

type TaskRef struct {
	ID       TaskID
	Revision uint64
}

type Update string

const (
	Claim    Update = "claim"
	Release  Update = "release"
	Complete Update = "complete"
)

type state struct {
	enabled bool
	tasks   []Task
}

type change struct {
	Root harness.SessionID `json:"root"`
	Mode *bool             `json:"enabled,omitempty"`
	Task *Task             `json:"task,omitempty"`
}

func (s *state) apply(c change) error {
	if c.Mode != nil {
		s.enabled = *c.Mode
		return nil
	}
	if c.Task == nil || c.Task.ID == 0 || uint64(c.Task.ID) > uint64(len(s.tasks))+1 {
		return errors.New("team: invalid journal task ID")
	}
	index := int(c.Task.ID) - 1
	if index == len(s.tasks) {
		if c.Task.Revision != 1 {
			return errors.New("team: invalid initial task revision")
		}
		s.tasks = append(s.tasks, *c.Task)
	} else {
		if c.Task.Revision != s.tasks[index].Revision+1 {
			return errors.New("team: invalid journal task revision")
		}
		s.tasks[index] = *c.Task
	}
	return nil
}

func (s state) get(id TaskID) (Task, error) {
	if id == 0 || uint64(id) > uint64(len(s.tasks)) {
		return Task{}, fmt.Errorf("%w: %d", ErrNotFound, id)
	}
	return s.tasks[int(id)-1], nil
}

func (s state) create(input NewTask) (Task, error) {
	if len(s.tasks) >= taskLimit {
		return Task{}, ErrLimit
	}
	title := strings.TrimSpace(input.Title)
	details := strings.TrimSpace(input.Details)
	if title == "" || len(title) > 200 || details == "" || len(details) > 16384 || len(input.Dependencies) > taskLimit {
		return Task{}, errors.New("team: invalid title, details or dependencies")
	}
	seen := make(map[TaskID]bool, len(input.Dependencies))
	for _, dependency := range input.Dependencies {
		if _, err := s.get(dependency); err != nil {
			return Task{}, err
		}
		if seen[dependency] {
			return Task{}, errors.New("team: duplicate task dependency")
		}
		seen[dependency] = true
	}
	// Only existing tasks can be prerequisites, so creation cannot create cycles.
	return Task{ID: TaskID(len(s.tasks) + 1), Title: title, Details: details,
		Dependencies: append([]TaskID(nil), input.Dependencies...), Revision: 1, Status: Pending}, nil
}

func (s state) update(ref TaskRef, operation Update, actor, root harness.SessionID) (Task, error) {
	task, err := s.get(ref.ID)
	if err != nil {
		return Task{}, err
	}
	if task.Revision != ref.Revision {
		return Task{}, fmt.Errorf("%w: current revision %d", ErrStale, task.Revision)
	}
	switch operation {
	case Claim:
		if task.Owner != "" && task.Owner != actor {
			return Task{}, ErrClaimed
		}
		if task.Status != Pending {
			return Task{}, ErrBlocked
		}
		for _, dependency := range task.Dependencies {
			required, err := s.get(dependency)
			if err != nil || required.Status != Completed {
				return Task{}, fmt.Errorf("%w: unfinished prerequisite %d", ErrBlocked, dependency)
			}
		}
		task.Status, task.Owner = InProgress, actor
	case Complete, Release:
		if task.Owner != actor && actor != root {
			return Task{}, ErrForbidden
		}
		if task.Status != InProgress {
			return Task{}, ErrTransition
		}
		if operation == Complete {
			task.Status = Completed
		} else {
			task.Status, task.Owner = Pending, ""
		}
	default:
		return Task{}, errors.New("team: unknown operation")
	}
	task.Revision++
	return task, nil
}
