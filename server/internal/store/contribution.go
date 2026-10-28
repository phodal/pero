package store

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// Contribution is the public, reviewed goal for a local coding contribution.
// It does not expose the private Task prompt, workspace, Worker or execution log.
type Contribution struct {
	TaskID         string        `json:"task_id"`
	Title          string        `json:"title"`
	Description    string        `json:"description"`
	Project        string        `json:"project"`
	SourceURL      string        `json:"source_url"`
	Repository     string        `json:"repository"`
	SourceRevision string        `json:"source_revision"`
	State          string        `json:"state"`
	ClaimedBy      *TaskClaimant `json:"claimed_by,omitempty"`
	PullRequest    *PullRequest  `json:"pull_request,omitempty"`
	task           *Task
}

type ContributionPage struct {
	Contributions []Contribution `json:"contributions"`
	HasMore       bool           `json:"has_more"`
	NextCursor    *string        `json:"next_cursor"`
}

// PullRequest records a submitted candidate, never verification or acceptance.
type PullRequest struct {
	URL            string `json:"url"`
	Branch         string `json:"branch"`
	HeadSHA        string `json:"head_sha"`
	SourceRevision string `json:"source_revision"`
	repository     string
}

var ErrContributionInput = errors.New("invalid pull request evidence")
var githubName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]*$`)
var commitSHA = regexp.MustCompile(`^[0-9a-f]{40}([0-9a-f]{24})?$`)

func githubRepository(raw string) (string, []string) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" {
		return "", nil
	}
	parts := strings.Split(strings.Trim(u.EscapedPath(), "/"), "/")
	if len(parts) < 2 || !githubName.MatchString(parts[0]) || !githubName.MatchString(parts[1]) || parts[1] == "." || parts[1] == ".." {
		return "", nil
	}
	return parts[0] + "/" + parts[1], parts
}

// ParsePullRequest validates external evidence once, at the HTTP boundary.
func ParsePullRequest(raw, branch, head, revision string) (PullRequest, error) {
	repository, parts := githubRepository(raw)
	if len(parts) != 4 || parts[2] != "pull" {
		return PullRequest{}, ErrContributionInput
	}
	number, err := strconv.ParseUint(parts[3], 10, 64)
	if err != nil || number == 0 || raw != "https://github.com/"+repository+"/pull/"+strconv.FormatUint(number, 10) || len(branch) == 0 || len(branch) > 255 || strings.ContainsAny(branch, "\x00\r\n") || !commitSHA.MatchString(head) || len(revision) == 0 || len(revision) > 256 || strings.ContainsAny(revision, "\x00\r\n") {
		return PullRequest{}, ErrContributionInput
	}
	return PullRequest{URL: raw, Branch: branch, HeadSHA: head, SourceRevision: revision, repository: repository}, nil
}

func newContribution(public PublicTask, task *Task, pr *PullRequest) Contribution {
	repository, _ := githubRepository(public.SourceURL)
	revision := ""
	if task.Source != nil {
		revision = task.Source.Revision
	}
	digest := sha256.Sum256([]byte(public.Title + "\x00" + public.Description + "\x00" + public.SourceURL + "\x00" + revision))
	claimant := task.ClaimedBy
	if claimant != nil {
		claimant = &TaskClaimant{ID: claimant.ID, Name: public.Contributor}
		if public.Contributor == "" {
			claimant = &TaskClaimant{ID: "reserved", Name: "Reserved"}
		}
	}
	c := Contribution{TaskID: task.ID, Title: public.Title, Description: public.Description, Project: public.Project, SourceURL: public.SourceURL, Repository: repository, SourceRevision: hex.EncodeToString(digest[:]), State: "available", ClaimedBy: claimant, PullRequest: pr, task: task}
	switch {
	case public.Accepted:
		c.State = "accepted"
	case taskExecutionBusy(task):
		c.State = "running"
	case pr != nil:
		c.State = "submitted"
	case taskSourceClosed(task):
		c.State = "closed"
	case taskSourceStale(task):
		c.State = "source_changed"
	case task.ClaimedBy != nil:
		c.State = "claimed"
	}
	return c
}

func (c *Contribution) claim(owner TaskClaimant) (bool, error) {
	if c.State != "available" && c.State != "claimed" {
		return false, ErrConflict
	}
	return c.task.claim(owner)
}
func (c *Contribution) release(owner string) (bool, error) {
	if c.PullRequest != nil {
		return false, ErrConflict
	}
	return c.task.release(owner)
}
func (c Contribution) submit(owner string, pr PullRequest) error {
	if c.task.ClaimedBy == nil || c.task.ClaimedBy.ID != owner {
		return ErrForbidden
	}
	if c.PullRequest != nil && *c.PullRequest == pr {
		return nil
	}
	if (c.State != "claimed" && c.State != "submitted") || pr.SourceRevision != c.SourceRevision || taskSourceClosed(c.task) || taskSourceStale(c.task) {
		return ErrConflict
	}
	if c.PullRequest != nil && (c.PullRequest.URL != pr.URL || c.PullRequest.Branch != pr.Branch || c.PullRequest.SourceRevision != pr.SourceRevision) {
		return ErrConflict
	}
	if !strings.EqualFold(c.Repository, pr.repository) {
		return ErrContributionInput
	}
	return nil
}

// Task owns human claim transitions for both scoped execution and public local work.
func (t *Task) claim(owner TaskClaimant) (bool, error) {
	if taskSourceClosed(t) {
		return false, ErrConflict
	}
	if t.ClaimedBy != nil {
		if t.ClaimedBy.ID == owner.ID {
			return false, nil
		}
		return false, ErrConflict
	}
	if taskBusy(t) {
		return false, ErrConflict
	}
	t.ClaimedBy = &owner
	return true, nil
}
func (t *Task) release(owner string) (bool, error) {
	if t.ClaimedBy == nil {
		return false, nil
	}
	if t.ClaimedBy.ID != owner {
		return false, ErrForbidden
	}
	if taskBusy(t) {
		return false, ErrConflict
	}
	t.ClaimedBy = nil
	return true, nil
}
