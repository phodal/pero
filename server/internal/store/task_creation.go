package store

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"unicode/utf8"
)

const clientCreatedTask = `EXISTS (SELECT 1 FROM operator_receipts receipt
	WHERE receipt.resource_id=tasks.id AND receipt.operation='create-task' AND starts_with(receipt.key,$1))`

func taskReceiptPrefix(clientID string) string { return "client:" + clientID + ":" }

var ErrTaskInput = errors.New("invalid manual task")

func (spec Spec) Validate() error {
	for _, field := range []struct {
		value string
		limit int
	}{
		{spec.Title, 240}, {spec.Prompt, 64000}, {spec.Acceptance, 16000},
		{spec.ProjectID, 128}, {spec.WorkspaceKey, 128}, {spec.AgentID, 128},
	} {
		if strings.TrimSpace(field.value) == "" || utf8.RuneCountInString(field.value) > field.limit || strings.ContainsRune(field.value, 0) {
			return ErrTaskInput
		}
	}
	return nil
}

// ClientTaskDraft carries the project authorization and creator's human claim.
// It does not dispatch or grant a Worker access to files or tools.
type ClientTaskDraft struct {
	spec                    Spec
	creator                 TaskClaimant
	requireWorkerCapability bool
}

func (spec Spec) ForClient(client *Client) (ClientTaskDraft, error) {
	if err := spec.validateManual(); err != nil {
		return ClientTaskDraft{}, err
	}
	if !slices.Contains(client.Projects, spec.ProjectID) {
		return ClientTaskDraft{}, ErrForbidden
	}
	return ClientTaskDraft{spec: spec, creator: TaskClaimant{ID: client.ID, Name: client.Name}}, nil
}

// RequireWorkerCapability restricts fresh drafts to an enabled Workspace Worker.
// An existing creation receipt is independent of current Worker configuration.
func (draft ClientTaskDraft) RequireWorkerCapability() ClientTaskDraft {
	draft.requireWorkerCapability = true
	return draft
}

func (spec Spec) validateManual() error {
	if err := spec.Validate(); err != nil {
		return err
	}
	if spec.Source != nil || spec.ParentTaskID != "" {
		return ErrTaskInput
	}
	return nil
}

func (s *Store) ClientCreateTask(ctx context.Context, draft ClientTaskDraft, key string) (*Task, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if key != "" {
		key = taskReceiptPrefix(draft.creator.ID) + key
	}
	task, err := createTaskTx(ctx, tx, draft.spec, key, &draft.creator, draft.requireWorkerCapability)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return task, nil
}

// ClientCreatedTasks reads only Tasks with this client's immutable creation receipt.
// The human claim may change independently of authorship.
func (s *Store) ClientCreatedTasks(ctx context.Context, client *Client, limit int) ([]Task, error) {
	rows, err := s.pool.Query(ctx, `SELECT tasks.id,tasks.spec,COALESCE(runs.status,'draft')
		FROM tasks LEFT JOIN runs ON runs.id=tasks.current_run_id
		WHERE tasks.spec->>'project_id'=ANY($2) AND `+clientCreatedTask+`
		ORDER BY tasks.created_at DESC,tasks.id DESC LIMIT $3`, taskReceiptPrefix(client.ID), client.Projects, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tasks []Task
	for rows.Next() {
		var task Task
		var spec []byte
		if err = rows.Scan(&task.ID, &spec, &task.State); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(spec, &task.Spec); err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func (s *Store) ClientCreatedTask(ctx context.Context, client *Client, id string) (*Task, error) {
	var owns bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tasks WHERE tasks.id=$2 AND `+clientCreatedTask+`)`, taskReceiptPrefix(client.ID), id).Scan(&owns); err != nil {
		return nil, err
	}
	if !owns {
		return nil, ErrNotFound
	}
	return s.ClientTask(ctx, client, id)
}
