// Package github imports read-only provider observations into the existing Go
// Task/Run owner. It never executes an Agent or writes to GitHub.
package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/phodal/pero/server/internal/store"
)

const MaxPages = 5

type Result struct {
	Imported   int      `json:"imported"`
	Updated    int      `json:"updated"`
	Dispatched int      `json:"dispatched"`
	Partial    bool     `json:"partial"`
	Errors     []string `json:"errors"`
	Missing    int      `json:"missing,omitempty"`
}
type RepositoryStatus struct {
	ProjectID     string `json:"project_id"`
	Owner         string `json:"owner"`
	Repo          string `json:"repo"`
	AutoDispatch  bool   `json:"auto_dispatch"`
	RequiredLabel string `json:"required_label"`
	LastSyncedAt  string `json:"last_synced_at,omitempty"`
	Partial       bool   `json:"partial"`
	Error         string `json:"error,omitempty"`
	RoadmapPath   string `json:"roadmap_path,omitempty"`
}
type Status struct {
	Configured   bool               `json:"configured"`
	Repositories []RepositoryStatus `json:"repositories"`
	Errors       []string           `json:"errors"`
	Running      bool               `json:"running"`
}
type Service struct {
	db      *store.Store
	repos   []store.GitHubRepository
	token   string
	base    *url.URL
	client  *http.Client
	syncMu  sync.Mutex
	stateMu sync.Mutex
	state   Status
}

// Options is constructor-only transport injection for isolated Go tests. No
// renderer/API/environment value can select a provider origin in production.
type Options struct {
	BaseURL string
	Client  *http.Client
}

var ownerPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
var repoPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)

func text(value string, max int) bool {
	return strings.TrimSpace(value) != "" && utf8.RuneCountInString(value) <= max && !strings.ContainsRune(value, 0)
}

func ParseRepositories(raw string) ([]store.GitHubRepository, error) {
	if raw == "" {
		return []store.GitHubRepository{}, nil
	}
	if len(raw) > 64000 {
		return nil, fmt.Errorf("GitHub repository configuration exceeds limit")
	}
	var configs []store.GitHubRepository
	d := json.NewDecoder(strings.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&configs); err != nil {
		return nil, fmt.Errorf("invalid PERO_GITHUB_REPOSITORIES")
	}
	var trailing any
	if err := d.Decode(&trailing); err != io.EOF {
		return nil, fmt.Errorf("expected one GitHub repository configuration")
	}
	if configs == nil || len(configs) > 8 {
		return nil, fmt.Errorf("configure at most eight GitHub repositories")
	}
	seen := map[string]bool{}
	for i := range configs {
		c := &configs[i]
		if !validRoadmapPath(c.RoadmapPath) {
			return nil, fmt.Errorf("invalid GitHub roadmap path at index %d", i)
		}
		if c.RequiredLabel == "" {
			c.RequiredLabel = "pero:ready"
		}
		if !text(c.ProjectID, 128) || !ownerPattern.MatchString(c.Owner) || len(c.Owner) > 100 || !repoPattern.MatchString(c.Repo) || len(c.Repo) > 100 || c.Repo == "." || c.Repo == ".." || !text(c.WorkspaceKey, 128) || !text(c.AgentID, 128) || !text(c.Acceptance, 16000) || !text(c.RequiredLabel, 128) || len(c.WorkerID) > 128 {
			return nil, fmt.Errorf("invalid GitHub repository binding at index %d", i)
		}
		key := c.ProjectID + ":" + strings.ToLower(c.Name())
		if seen[key] {
			return nil, fmt.Errorf("duplicate GitHub repository binding")
		}
		seen[key] = true
	}
	return configs, nil
}

func New(db *store.Store, repos []store.GitHubRepository, token string, options ...Options) (*Service, error) {
	if len(token) > 4096 || strings.ContainsAny(token, "\r\n\t ") {
		return nil, fmt.Errorf("invalid GitHub credential configuration")
	}
	encoded, _ := json.Marshal(repos)
	configs, err := ParseRepositories(string(encoded))
	if err != nil {
		return nil, err
	}
	base := "https://api.github.com/"
	client := &http.Client{Timeout: 8 * time.Second}
	if len(options) > 0 {
		if options[0].BaseURL != "" {
			base = options[0].BaseURL
		}
		if options[0].Client != nil {
			copy := *options[0].Client
			client = &copy
		}
	}
	u, err := url.Parse(base)
	if err != nil || !u.IsAbs() || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, fmt.Errorf("invalid GitHub transport origin")
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	s := &Service{db: db, repos: configs, token: token, base: u, client: client, state: Status{Configured: len(configs) > 0, Repositories: []RepositoryStatus{}, Errors: []string{}}}
	for _, r := range configs {
		s.state.Repositories = append(s.state.Repositories, RepositoryStatus{ProjectID: r.ProjectID, Owner: r.Owner, Repo: r.Repo, AutoDispatch: r.AutoDispatch, RequiredLabel: r.RequiredLabel, RoadmapPath: r.RoadmapPath})
	}
	return s, nil
}

func (s *Service) StatusForProjects(projects []string) Status {
	all := s.Status()
	state := Status{Repositories: []RepositoryStatus{}, Errors: []string{}}
	allowed := map[string]bool{}
	for _, project := range projects {
		allowed[project] = true
	}
	for _, repo := range all.Repositories {
		if allowed[repo.ProjectID] {
			state.Repositories = append(state.Repositories, repo)
			if repo.Error != "" {
				state.Errors = append(state.Errors, repo.Owner+"/"+repo.Repo+": "+repo.Error)
			}
		}
	}
	state.Configured = len(state.Repositories) > 0
	state.Running = all.Running && state.Configured
	return state
}

func (s *Service) Status() Status {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	state := s.state
	state.Repositories = append([]RepositoryStatus{}, s.state.Repositories...)
	state.Errors = append([]string{}, s.state.Errors...)
	return state
}

func (s *Service) Sync(ctx context.Context) (Result, error) {
	result := Result{Errors: []string{}}
	if !s.syncMu.TryLock() {
		return result, store.ErrConflict
	}
	defer s.syncMu.Unlock()
	s.stateMu.Lock()
	s.state.Running = true
	s.stateMu.Unlock()
	defer func() {
		s.stateMu.Lock()
		s.state.Running = false
		s.state.Errors = append([]string{}, result.Errors...)
		s.stateMu.Unlock()
	}()
	for i, config := range s.repos {
		issues, partial, fetchErr := s.observe(ctx, config)
		message := ""
		if fetchErr != nil {
			message = fetchErr.Error()
			partial = true
		}
		if fetchErr == nil || len(issues) > 0 {
			for _, issue := range issues {
				change, err := s.db.SyncGitHubIssue(ctx, config, issue)
				if err != nil {
					partial = true
					message = "Issue #" + fmt.Sprint(issue.Number) + " could not be imported"
					if len(result.Errors) < 32 {
						result.Errors = append(result.Errors, config.Name()+": "+message)
					}
					continue
				}
				if change.Imported {
					result.Imported++
				}
				if change.Updated {
					result.Updated++
				}
				if change.Dispatched {
					result.Dispatched++
				}
			}
		}
		if config.RoadmapPath != "" {
			snapshot, parseErrors, readErr := s.observeRoadmap(ctx, config)
			if readErr != nil {
				partial = true
				message = readErr.Error()
			} else {
				change, err := s.db.SyncRoadmap(ctx, config, snapshot)
				if err != nil {
					partial = true
					message = "Roadmap tasks could not be imported"
				} else {
					result.Imported += change.Imported
					result.Updated += change.Updated
					result.Missing += change.Missing
				}
				partial = partial || snapshot.Partial
				for _, failure := range parseErrors {
					if len(result.Errors) < 32 {
						result.Errors = append(result.Errors, config.Name()+": "+failure)
					}
				}
			}
		}
		if message != "" && len(result.Errors) < 32 {
			result.Errors = append(result.Errors, config.Name()+": "+message)
		}
		result.Partial = result.Partial || partial
		_ = s.db.GitHubSyncRecord(ctx, config, partial, message)
		s.stateMu.Lock()
		status := &s.state.Repositories[i]
		status.LastSyncedAt = time.Now().UTC().Format(time.RFC3339)
		status.Partial = partial
		status.Error = message
		s.stateMu.Unlock()
	}
	return result, nil
}

// Start uses the same ingestion path as explicit sync, with one scheduler owner.
func (s *Service) Start(ctx context.Context, interval time.Duration) {
	if len(s.repos) == 0 {
		return
	}
	go func() {
		timer := time.NewTicker(interval)
		defer timer.Stop()
		for {
			op, done := context.WithTimeout(ctx, 50*time.Second)
			_, _ = s.Sync(op)
			done()
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
		}
	}()
}
