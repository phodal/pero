package github

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"path"
	"regexp"
	"strings"

	"github.com/phodal/pero/server/internal/store"
)

var commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

func validRoadmapPath(value string) bool {
	return value == "" || value == "auto" || (len(value) <= 512 && !strings.ContainsAny(value, "\x00\r\n\\") && !strings.HasPrefix(value, "/") && path.Clean(value) == value && value != ".." && !strings.HasPrefix(value, "../") && strings.EqualFold(path.Ext(value), ".md"))
}
func escapedPath(value string) string {
	segments := strings.Split(value, "/")
	for i := range segments {
		segments[i] = url.PathEscape(segments[i])
	}
	return strings.Join(segments, "/")
}

func (s *Service) observeRoadmap(ctx context.Context, config store.GitHubRepository) (store.RoadmapSnapshot, []string, error) {
	snapshot := store.RoadmapSnapshot{Repository: config.Name()}
	repoPath := "/repos/" + url.PathEscape(config.Owner) + "/" + url.PathEscape(config.Repo)
	var repo struct {
		ID      json.Number `json:"id"`
		Name    string      `json:"full_name"`
		Branch  string      `json:"default_branch"`
		Private bool        `json:"private"`
	}
	if _, err := s.get(ctx, repoPath, nil, &repo); err != nil {
		return snapshot, nil, err
	}
	if !numericID(repo.ID) || !strings.EqualFold(repo.Name, config.Name()) || !text(repo.Branch, 255) {
		return snapshot, nil, fmt.Errorf("invalid GitHub repository identity or default branch")
	}
	if err := s.db.BindGitHubRepository(ctx, config, repo.ID.String(), repo.Private); err != nil {
		return snapshot, nil, fmt.Errorf("GitHub repository binding changed or unavailable")
	}
	snapshot.RepositoryID = repo.ID.String()
	var commit struct {
		SHA string `json:"sha"`
	}
	if _, err := s.get(ctx, repoPath+"/commits/"+url.PathEscape(repo.Branch), nil, &commit); err != nil {
		return snapshot, nil, err
	}
	if !commitPattern.MatchString(commit.SHA) {
		return snapshot, nil, fmt.Errorf("invalid GitHub commit identity")
	}
	snapshot.CommitSHA = commit.SHA
	paths := []string{config.RoadmapPath}
	if config.RoadmapPath == "auto" {
		paths = []string{"ROADMAP.md", "docs/ROADMAP.md"}
	}
	for _, file := range paths {
		var content struct {
			Type     string `json:"type"`
			Encoding string `json:"encoding"`
			Content  string `json:"content"`
			SHA      string `json:"sha"`
			Path     string `json:"path"`
			Size     int    `json:"size"`
		}
		_, err := s.get(ctx, repoPath+"/contents/"+escapedPath(file), url.Values{"ref": {commit.SHA}}, &content)
		if errors.Is(err, errNotFound) && config.RoadmapPath == "auto" {
			continue
		}
		if err != nil {
			return snapshot, nil, err
		}
		if content.Type != "file" || content.Encoding != "base64" || content.Path != file || content.Size < 0 || content.Size > 512*1024 || !commitPattern.MatchString(content.SHA) {
			return snapshot, nil, fmt.Errorf("invalid or oversized GitHub roadmap content")
		}
		decoded, err := base64.StdEncoding.DecodeString(content.Content)
		if err != nil || len(decoded) != content.Size || len(decoded) > 512*1024 {
			return snapshot, nil, fmt.Errorf("incomplete GitHub roadmap content")
		}
		hash := sha1.New()
		fmt.Fprintf(hash, "blob %d\x00", len(decoded))
		hash.Write(decoded)
		if hex.EncodeToString(hash.Sum(nil)) != content.SHA {
			return snapshot, nil, fmt.Errorf("GitHub roadmap blob digest mismatch")
		}
		parsed := ParseRoadmap(decoded)
		snapshot.Path = file
		snapshot.BlobSHA = content.SHA
		snapshot.Partial = parsed.Partial
		snapshot.Items = []store.RoadmapItem{}
		depths := map[string]int{}
		for _, item := range parsed.Items {
			depth := 0
			if item.ParentID != "" {
				depth = depths[item.ParentID] + 1
			}
			depths[item.ID] = depth
			snapshot.Items = append(snapshot.Items, store.RoadmapItem{ID: item.ID, ParentID: item.ParentID, Title: item.Title, Text: item.Text, Checked: item.Checked, Line: item.Line, Depth: depth, Headings: item.Headings, Tags: item.Tags})
		}
		return snapshot, parsed.Errors, nil
	}
	return snapshot, nil, fmt.Errorf("configured ROADMAP.md was not found; prior tasks were retained")
}
