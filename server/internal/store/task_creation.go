package store

import (
	"context"
	"errors"
	"slices"
	"strings"
	"unicode/utf8"
)

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
	spec    Spec
	creator TaskClaimant
}

func (spec Spec) ForClient(client *Client) (ClientTaskDraft, error) {
	if err := spec.Validate(); err != nil {
		return ClientTaskDraft{}, err
	}
	if spec.Source != nil || spec.ParentTaskID != "" {
		return ClientTaskDraft{}, ErrTaskInput
	}
	if !slices.Contains(client.Projects, spec.ProjectID) {
		return ClientTaskDraft{}, ErrForbidden
	}
	return ClientTaskDraft{spec: spec, creator: TaskClaimant{ID: client.ID, Name: client.Name}}, nil
}

func (s *Store) ClientCreateTask(ctx context.Context, draft ClientTaskDraft, key string) (*Task, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if key != "" {
		key = "client:" + draft.creator.ID + ":" + key
	}
	task, err := createTaskTx(ctx, tx, draft.spec, key, &draft.creator)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return task, nil
}
