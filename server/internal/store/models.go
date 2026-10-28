package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrNotFound  = errors.New("not found")
	ErrConflict  = errors.New("operation conflicts with current state or receipt")
	ErrForbidden = errors.New("worker is not authorized for this operation")
	ErrLease     = errors.New("execution lease is no longer valid")
)

type Spec struct {
	Title        string   `json:"title"`
	Prompt       string   `json:"prompt"`
	Acceptance   string   `json:"acceptance"`
	ProjectID    string   `json:"project_id"`
	WorkspaceKey string   `json:"workspace_key"`
	AgentID      string   `json:"agent_id"`
	Source       *Source  `json:"source,omitempty"`
	ParentTaskID string   `json:"parent_task_id,omitempty"`
	Tags         []string `json:"tags,omitempty"`
}

// Source records provider goal data, never an execution grant or acceptance.
type Source struct {
	Kind            string   `json:"kind"`
	Repository      string   `json:"repository"`
	IssueNumber     int64    `json:"issue_number,omitempty"`
	URL             string   `json:"url"`
	Revision        string   `json:"revision"`
	State           string   `json:"state"`
	UpdatedAt       string   `json:"updated_at,omitempty"`
	IssueID         string   `json:"issue_id,omitempty"`
	RepositoryID    string   `json:"repository_id"`
	Path            string   `json:"path,omitempty"`
	ItemID          string   `json:"item_id,omitempty"`
	ParentItemID    string   `json:"parent_item_id,omitempty"`
	Line            int      `json:"line,omitempty"`
	Headings        []string `json:"headings,omitempty"`
	Tags            []string `json:"tags,omitempty"`
	CommitSHA       string   `json:"commit_sha,omitempty"`
	BlobSHA         string   `json:"blob_sha,omitempty"`
	Depth           int      `json:"depth,omitempty"`
	MissingAtCommit string   `json:"missing_at_commit,omitempty"`
}

type TaskClaimant struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Task struct {
	ID string `json:"id"`
	Spec
	State                 string        `json:"state"`
	CurrentRunID          string        `json:"current_run_id,omitempty"`
	Run                   *Run          `json:"run,omitempty"`
	ClaimedBy             *TaskClaimant `json:"claimed_by,omitempty"`
	LatestSource          *Source       `json:"latest_source,omitempty"`
	contributionSubmitted bool
}

type TaskPage struct {
	Tasks      []Task  `json:"tasks"`
	HasMore    bool    `json:"has_more"`
	NextCursor *string `json:"next_cursor"`
}

type TaskFilter struct{ SourceKind, Tag string }

type EventTail struct {
	Events    []Event `json:"events"`
	Truncated bool    `json:"events_truncated"`
	FirstSeq  *int64  `json:"events_first_seq"`
	LastSeq   *int64  `json:"events_last_seq"`
}

type Run struct {
	ID             string     `json:"id"`
	TaskID         string     `json:"task_id"`
	Generation     int64      `json:"generation"`
	WorkerID       string     `json:"worker_id,omitempty"`
	InstanceID     string     `json:"instance_id,omitempty"`
	Status         string     `json:"status"`
	LeaseExpiresAt *time.Time `json:"lease_expires_at,omitempty"`
	Spec           Spec       `json:"spec"`
	Summary        string     `json:"summary"`
}

type Worker struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Projects []string `json:"projects"`
	Labels   []string `json:"labels"`
}

type Event struct {
	Seq  int64           `json:"seq"`
	Kind string          `json:"kind"`
	Text string          `json:"text"`
	Data json.RawMessage `json:"data,omitempty"`
}

type Completion struct {
	Outcome string `json:"outcome"`
	Summary string `json:"summary"`
}

func newID(prefix string) string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return prefix + "_" + hex.EncodeToString(b[:])
}
