package github

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/phodal/pero/server/internal/store"
)

const apiVersion = "2026-03-10"
const maxResponseBytes = 2 * 1024 * 1024

var errNotFound = errors.New("GitHub repository unavailable")

type rawIssue struct {
	ID          json.Number     `json:"id"`
	NodeID      string          `json:"node_id"`
	Number      int64           `json:"number"`
	URL         string          `json:"html_url"`
	Title       string          `json:"title"`
	Body        string          `json:"body"`
	State       string          `json:"state"`
	UpdatedAt   string          `json:"updated_at"`
	PullRequest json.RawMessage `json:"pull_request"`
	Labels      []struct {
		Name string `json:"name"`
	} `json:"labels"`
}

func (s *Service) get(ctx context.Context, path string, q url.Values, target any) (http.Header, error) {
	decoded, decodeErr := url.PathUnescape(path)
	if decodeErr != nil {
		return nil, fmt.Errorf("invalid GitHub read path")
	}
	u := s.base.ResolveReference(&url.URL{Path: decoded, RawPath: path, RawQuery: q.Encode()})
	r, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("invalid GitHub read")
	}
	r.Header.Set("Accept", "application/vnd.github+json")
	r.Header.Set("X-GitHub-Api-Version", apiVersion)
	r.Header.Set("User-Agent", "OpenPero/0.1")
	if s.token != "" {
		r.Header.Set("Authorization", "Bearer "+s.token)
	}
	response, err := s.client.Do(r)
	if err != nil {
		return nil, fmt.Errorf("GitHub read failed")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		failureBody, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
		secondary := strings.Contains(strings.ToLower(string(failureBody)), "secondary rate limit") || strings.Contains(strings.ToLower(string(failureBody)), "abuse detection")
		if response.StatusCode == 429 || response.StatusCode == 403 && (response.Header.Get("Retry-After") != "" || response.Header.Get("X-RateLimit-Remaining") == "0" || secondary) {
			return nil, fmt.Errorf("GitHub rate limited; retry after the provider reset")
		}
		switch response.StatusCode {
		case 401:
			return nil, fmt.Errorf("GitHub authentication required")
		case 403:
			return nil, fmt.Errorf("GitHub repository access denied")
		case 404:
			return nil, errNotFound
		default:
			return nil, fmt.Errorf("GitHub returned HTTP %d", response.StatusCode)
		}
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil || len(body) > maxResponseBytes {
		return nil, fmt.Errorf("GitHub response exceeds read budget")
	}
	if err = json.Unmarshal(body, target); err != nil {
		return nil, fmt.Errorf("invalid GitHub response")
	}
	return response.Header, nil
}

func numericID(value json.Number) bool {
	v, err := strconv.ParseUint(value.String(), 10, 64)
	return err == nil && v > 0
}
func (s *Service) observe(ctx context.Context, config store.GitHubRepository) ([]store.GitHubIssue, bool, error) {
	path := "/repos/" + url.PathEscape(config.Owner) + "/" + url.PathEscape(config.Repo)
	var repo struct {
		ID      json.Number `json:"id"`
		Name    string      `json:"full_name"`
		Private bool        `json:"private"`
	}
	if _, err := s.get(ctx, path, nil, &repo); err != nil {
		return nil, true, err
	}
	if !numericID(repo.ID) || !strings.EqualFold(repo.Name, config.Name()) {
		return nil, true, fmt.Errorf("GitHub repository identity mismatch")
	}
	if err := s.db.BindGitHubRepository(ctx, config, repo.ID.String(), repo.Private); err != nil {
		if errors.Is(err, store.ErrConflict) {
			return nil, true, fmt.Errorf("GitHub repository identity changed; review its binding")
		}
		return nil, true, fmt.Errorf("GitHub source storage is unavailable")
	}
	issues := []store.GitHubIssue{}
	seen := map[string]bool{}
	partial := false
	skipped := 0
	finish := func() ([]store.GitHubIssue, bool, error) {
		if skipped > 0 {
			return issues, true, fmt.Errorf("%d invalid or oversized GitHub issues were skipped", skipped)
		}
		return issues, partial, nil
	}
	for page := 1; page <= MaxPages; page++ {
		var raw []rawIssue
		headers, err := s.get(ctx, path+"/issues", url.Values{"state": {"all"}, "sort": {"updated"}, "direction": {"desc"}, "per_page": {"100"}, "page": {strconv.Itoa(page)}}, &raw)
		if err != nil {
			return issues, true, err
		}
		if len(raw) > 100 {
			return issues, true, fmt.Errorf("GitHub issue page exceeds item budget")
		}
		for _, item := range raw {
			if len(item.PullRequest) > 0 && string(item.PullRequest) != "null" {
				continue
			}
			issue, err := normalizeIssue(config, repo.ID.String(), item)
			if err != nil {
				partial = true
				skipped++
				continue
			}
			if seen[issue.ID] {
				continue
			}
			seen[issue.ID] = true
			issues = append(issues, issue)
		}
		// Never follow provider URLs with credentials; only increment a local page
		// after proving the advertised next page stays inside this exact endpoint.
		next, err := s.hasNext(headers.Get("Link"), path+"/issues", page+1)
		if err != nil {
			return issues, true, err
		}
		if !next {
			return finish()
		}
		if page == MaxPages {
			return issues, true, fmt.Errorf("GitHub issue pagination budget reached")
		}
	}
	return finish()
}

func (s *Service) hasNext(link, path string, page int) (bool, error) {
	if link == "" {
		return false, nil
	}
	for _, part := range strings.Split(link, ",") {
		if !strings.Contains(part, `rel="next"`) {
			continue
		}
		start, end := strings.Index(part, "<"), strings.Index(part, ">")
		if start < 0 || end <= start {
			return false, fmt.Errorf("invalid GitHub pagination")
		}
		u, err := url.Parse(part[start+1 : end])
		if err != nil || u.Scheme != s.base.Scheme || u.Host != s.base.Host || u.Path != path || u.User != nil || u.Fragment != "" || u.Query().Get("page") != strconv.Itoa(page) {
			return false, fmt.Errorf("GitHub pagination changed scope")
		}
		return true, nil
	}
	return false, nil
}

func normalizeIssue(config store.GitHubRepository, repositoryID string, item rawIssue) (store.GitHubIssue, error) {
	if !numericID(item.ID) || !text(item.NodeID, 256) || item.Number <= 0 || item.Number > 9007199254740991 || !text(item.Title, 240) || len(item.Body) > 256000 || !text(strings.TrimSpace(item.Title+"\n\n"+item.Body), 64000) || (item.State != "open" && item.State != "closed") || len(item.Labels) > 100 {
		return store.GitHubIssue{}, fmt.Errorf("invalid or oversized GitHub issue #%d", item.Number)
	}
	if _, err := time.Parse(time.RFC3339, item.UpdatedAt); err != nil {
		return store.GitHubIssue{}, fmt.Errorf("invalid GitHub issue time")
	}
	u, err := url.Parse(item.URL)
	expected := "/" + config.Owner + "/" + config.Repo + "/issues/" + strconv.FormatInt(item.Number, 10)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !strings.EqualFold(u.Path, expected) {
		return store.GitHubIssue{}, fmt.Errorf("GitHub issue URL changed scope")
	}
	labels := []string{}
	for _, label := range item.Labels {
		if !text(label.Name, 128) {
			return store.GitHubIssue{}, fmt.Errorf("invalid GitHub issue label")
		}
		labels = append(labels, label.Name)
	}
	sort.Strings(labels)
	return store.GitHubIssue{RepositoryID: repositoryID, Repository: config.Name(), ID: item.ID.String(), NodeID: item.NodeID, Number: item.Number, URL: item.URL, Title: item.Title, Body: item.Body, State: item.State, UpdatedAt: item.UpdatedAt, Labels: labels}, nil
}
