// Package team provides shared task ownership for a live native subagent tree.
// Claude's session-local task journal is deliberately separate.
package team

import (
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
)

const (
	eventType = "pero/team/board"
	taskLimit = 256
)

var (
	ErrDisabled       = errors.New("TEAM_DISABLED")
	ErrForbidden      = errors.New("TEAM_TASK_UNAUTHORIZED")
	ErrNotFound       = errors.New("TEAM_TASK_NOT_FOUND")
	ErrStale          = errors.New("TEAM_TASK_STALE_REVISION")
	ErrBlocked        = errors.New("TEAM_TASK_BLOCKED")
	ErrClaimed        = errors.New("TEAM_TASK_ALREADY_CLAIMED")
	ErrTransition     = errors.New("TEAM_TASK_INVALID_TRANSITION")
	ErrLeadRequired   = errors.New("TEAM_LEAD_REQUIRED")
	ErrMemberNotFound = errors.New("TEAM_MEMBER_NOT_FOUND")
	ErrLimit          = errors.New("TEAM_TASK_LIMIT")
	ErrDeleted        = errors.New("TEAM_TASK_DELETED")
	ErrDependents     = errors.New("TEAM_TASK_HAS_DEPENDENTS")
	ErrCycle          = errors.New("TEAM_TASK_DEPENDENCY_CYCLE")
	ErrArgument       = errors.New("TEAM_INVALID_ARGUMENT")
	ErrWriteScope     = errors.New("TEAM_INVALID_WRITE_SCOPE")
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
	Deleted    Status = "deleted"
)

// writeScope is a normalized workspace-relative path prefix for coordination
// only. The board never resolves it against the filesystem.
type writeScope string

func normalizeWriteScopes(inputs []string) ([]writeScope, error) {
	if len(inputs) > 32 {
		return nil, fmt.Errorf("%w: too many write scopes", ErrArgument)
	}
	var scopes []writeScope
	for _, input := range inputs {
		prefix := strings.TrimRight(strings.TrimPrefix(strings.ReplaceAll(input, "\\", "/"), "./"), "/")
		drive := len(prefix) >= 2 && prefix[1] == ':' && ((prefix[0] >= 'a' && prefix[0] <= 'z') || (prefix[0] >= 'A' && prefix[0] <= 'Z'))
		if len(input) > 256 || drive || strings.ContainsRune(prefix, 0) {
			return nil, ErrWriteScope
		}
		for segment := range strings.SplitSeq(prefix, "/") {
			if segment == "" || segment == "." || segment == ".." {
				return nil, ErrWriteScope
			}
		}
		scope := writeScope(prefix)
		if !slices.Contains(scopes, scope) {
			scopes = append(scopes, scope)
		}
	}
	return scopes, nil
}

func (s writeScope) overlaps(other writeScope) bool {
	return s == other || strings.HasPrefix(string(s), string(other)+"/") ||
		strings.HasPrefix(string(other), string(s)+"/")
}

type Task struct {
	ID           TaskID            `json:"id"`
	Title        string            `json:"subject"`
	Details      string            `json:"description,omitempty"`
	Dependencies []TaskID          `json:"blockedBy,omitempty"`
	WriteScopes  []writeScope      `json:"writeScopes,omitempty"`
	Revision     uint64            `json:"revision"`
	Status       Status            `json:"status"`
	Owner        harness.SessionID `json:"owner,omitempty"`
}

type NewTask struct {
	Title        string
	Details      string
	Dependencies []TaskID
	WriteScopes  []string
}

type TaskRef struct {
	ID       TaskID
	Revision uint64
}

type Update string

const (
	Claim           Update = "claim"
	Release         Update = "release"
	Complete        Update = "complete"
	Reassign        Update = "reassign"
	Edit            Update = "edit"
	SetDependencies Update = "set_dependencies"
	Reopen          Update = "reopen"
	Delete          Update = "delete"
)

type mutation struct {
	operation      Update
	title, details *string
	dependencies   *[]TaskID
	writeScopes    *[]string
}

type TaskView struct {
	Task
	Ready              bool     `json:"ready"`
	WriteScopeWarnings []string `json:"writeScopeWarnings,omitempty"`
}

type taskQuery struct {
	status         Status
	owner          harness.SessionID
	unowned, ready *bool
	cursor         uint64
	limit          int
}

type taskPage struct {
	Tasks      []TaskView `json:"tasks"`
	NextCursor int        `json:"nextCursor,omitempty"`
}

type state struct {
	enabled  bool
	tasks    []Task
	revision uint64
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

func taskText(input, label string, limit int) (string, error) {
	value := strings.TrimSpace(input)
	if value == "" || len(value) > limit {
		return "", fmt.Errorf("%w: invalid %s", ErrArgument, label)
	}
	return value, nil
}

func (s state) validateDependencies(id TaskID, dependencies []TaskID) error {
	if len(dependencies) > taskLimit {
		return fmt.Errorf("%w: too many task dependencies", ErrArgument)
	}
	direct := make(map[TaskID]bool, len(dependencies))
	for _, dependency := range dependencies {
		task, err := s.get(dependency)
		if err != nil || task.Status == Deleted {
			return fmt.Errorf("%w: prerequisite %d", ErrNotFound, dependency)
		}
		if direct[dependency] {
			return fmt.Errorf("%w: duplicate prerequisite %d", ErrArgument, dependency)
		}
		direct[dependency] = true
	}
	visited := make(map[TaskID]bool)
	pending := append([]TaskID(nil), dependencies...)
	for len(pending) != 0 {
		dependency := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if dependency == id {
			return fmt.Errorf("%w: task %d cannot depend on itself", ErrCycle, id)
		}
		if !visited[dependency] {
			visited[dependency] = true
			task, err := s.get(dependency)
			if err != nil || task.Status == Deleted {
				return fmt.Errorf("%w: prerequisite %d", ErrNotFound, dependency)
			}
			pending = append(pending, task.Dependencies...)
		}
	}
	return nil
}

func (s state) create(input NewTask) (Task, error) {
	// Keep the existing lifetime bound, including tombstones: IDs are never
	// recycled and the whole board is replayed from the root journal.
	if len(s.tasks) >= taskLimit {
		return Task{}, ErrLimit
	}
	title, err := taskText(input.Title, "subject", 200)
	if err != nil {
		return Task{}, err
	}
	details, err := taskText(input.Details, "description", 16384)
	if err != nil {
		return Task{}, err
	}
	id := TaskID(len(s.tasks) + 1)
	if err := s.validateDependencies(id, input.Dependencies); err != nil {
		return Task{}, err
	}
	scopes, err := normalizeWriteScopes(input.WriteScopes)
	if err != nil {
		return Task{}, err
	}
	return Task{ID: id, Title: title, Details: details, WriteScopes: scopes,
		Dependencies: append([]TaskID(nil), input.Dependencies...), Revision: 1, Status: Pending}, nil
}

func (s state) list() []Task {
	active := make([]Task, 0, len(s.tasks))
	for _, task := range s.tasks {
		if task.Status != Deleted {
			active = append(active, task)
		}
	}
	return active
}

// page applies filters before paging. The original board remains the source
// of readiness and overlap warnings even for tasks outside the filtered page.
func (s state) page(q taskQuery) taskPage {
	matched := make([]Task, 0, len(s.tasks))
	for _, task := range s.tasks {
		if task.Status == Deleted || q.status != "" && task.Status != q.status ||
			q.owner != "" && task.Owner != q.owner ||
			q.unowned != nil && (task.Owner == "") != *q.unowned ||
			q.ready != nil && s.isReady(task) != *q.ready {
			continue
		}
		matched = append(matched, task)
	}
	start := int(min(q.cursor, uint64(len(matched))))
	end := min(start+q.limit, len(matched))
	page := taskPage{Tasks: make([]TaskView, 0, end-start)}
	for _, task := range matched[start:end] {
		task.Details = ""
		page.Tasks = append(page.Tasks, s.view(task))
	}
	if end < len(matched) {
		page.NextCursor = end
	}
	return page
}

func (s state) isReady(task Task) bool {
	return task.Status == Pending && s.ready(task) == nil
}

func (s state) view(task Task) TaskView {
	view := TaskView{Task: task, Ready: s.isReady(task)}
	if len(task.WriteScopes) == 0 || (task.Status != Pending && task.Status != InProgress) {
		return view
	}
	for _, other := range s.tasks {
		if other.ID == task.ID || other.Status != InProgress {
			continue
		}
		for _, scope := range task.WriteScopes {
			if slices.ContainsFunc(other.WriteScopes, scope.overlaps) {
				view.WriteScopeWarnings = append(view.WriteScopeWarnings, fmt.Sprintf("write scopes overlap with task %d", other.ID))
				break
			}
		}
	}
	return view
}

func (s state) current(ref TaskRef) (Task, error) {
	task, err := s.get(ref.ID)
	if err != nil {
		return Task{}, err
	}
	if task.Revision != ref.Revision {
		return Task{}, fmt.Errorf("%w: current revision %d", ErrStale, task.Revision)
	}
	if task.Status == Deleted {
		return Task{}, ErrDeleted
	}
	return task, nil
}

func (s state) ready(task Task) error {
	for _, dependency := range task.Dependencies {
		required, err := s.get(dependency)
		if err != nil || required.Status != Completed {
			return fmt.Errorf("%w: unfinished prerequisite %d", ErrBlocked, dependency)
		}
	}
	return nil
}

func (s state) reassign(ref TaskRef, target harness.SessionID) (Task, error) {
	task, err := s.current(ref)
	if err != nil {
		return Task{}, err
	}
	if task.Status != Pending && task.Status != InProgress {
		return Task{}, ErrTransition
	}
	if target == "" {
		task.Status, task.Owner = Pending, ""
	} else {
		if err := s.ready(task); err != nil {
			return Task{}, err
		}
		task.Status, task.Owner = InProgress, target
	}
	task.Revision++
	return task, nil
}

func (s state) update(ref TaskRef, input mutation, actor, root harness.SessionID) (Task, error) {
	task, err := s.current(ref)
	if err != nil {
		return Task{}, err
	}
	if input.operation != Claim && task.Owner != actor && actor != root {
		return Task{}, ErrForbidden
	}
	switch input.operation {
	case Claim:
		if task.Owner != "" && task.Owner != actor {
			return Task{}, ErrClaimed
		}
		if task.Status != Pending {
			return Task{}, ErrBlocked
		}
		if err := s.ready(task); err != nil {
			return Task{}, err
		}
		task.Status, task.Owner = InProgress, actor
	case Complete, Release:
		if task.Status != InProgress {
			return Task{}, ErrTransition
		}
		if input.operation == Complete {
			task.Status = Completed
		} else {
			task.Status, task.Owner = Pending, ""
		}
	case Edit:
		if input.title == nil && input.details == nil && input.writeScopes == nil {
			return Task{}, fmt.Errorf("%w: edit requires subject, description, or write_scopes", ErrArgument)
		}
		if input.title != nil {
			task.Title, err = taskText(*input.title, "subject", 200)
			if err != nil {
				return Task{}, err
			}
		}
		if input.details != nil {
			task.Details, err = taskText(*input.details, "description", 16384)
			if err != nil {
				return Task{}, err
			}
		}
		if input.writeScopes != nil {
			task.WriteScopes, err = normalizeWriteScopes(*input.writeScopes)
			if err != nil {
				return Task{}, err
			}
		}
	case SetDependencies:
		if input.dependencies == nil {
			return Task{}, fmt.Errorf("%w: set_dependencies requires blocked_by", ErrArgument)
		}
		if err := s.validateDependencies(task.ID, *input.dependencies); err != nil {
			return Task{}, err
		}
		task.Dependencies = append([]TaskID(nil), (*input.dependencies)...)
	case Reopen:
		if task.Status != Completed {
			return Task{}, ErrTransition
		}
		task.Status, task.Owner = Pending, ""
	case Delete:
		for _, dependent := range s.tasks {
			if dependent.Status != Deleted && slices.Contains(dependent.Dependencies, task.ID) {
				return Task{}, fmt.Errorf("%w: task %d still blocks %d", ErrDependents, task.ID, dependent.ID)
			}
		}
		task.Status = Deleted
	default:
		return Task{}, fmt.Errorf("%w: unknown operation", ErrArgument)
	}
	task.Revision++
	return task, nil
}
