package github

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/phodal/pero/server/internal/store"
)

func gitBlob(data []byte) string {
	hash := sha1.New()
	fmt.Fprintf(hash, "blob %d\x00", len(data))
	hash.Write(data)
	return hex.EncodeToString(hash.Sum(nil))
}

func TestPinnedRoadmapReadHierarchyAndAutoFallback(t *testing.T) {
	for _, path := range []string{"ROADMAP.md", "docs/ROADMAP.md"} {
		t.Run(path, func(t *testing.T) {
			db := database(t)
			config := config()
			config.RoadmapPath = "auto"
			config.AutoDispatch = true
			commit := strings.Repeat("a", 40)
			markdown := []byte("# Project\n## Platform\n- [ ] Parent. Parent goal #go <!--pero:id:parent-->\n  - [ ] Child. Child goal #runtime <!--pero:id:child-->\n- [x] Complete. Completed goal <!--pero:id:done-->\n")
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" {
					t.Error("roadmap import attempted a write")
				}
				switch r.URL.Path {
				case "/repos/acme/repo":
					w.Write([]byte(`{"id":200,"full_name":"acme/repo","default_branch":"main"}`))
				case "/repos/acme/repo/issues":
					w.Write([]byte(`[]`))
				case "/repos/acme/repo/commits/main":
					json.NewEncoder(w).Encode(map[string]string{"sha": commit})
				case "/repos/acme/repo/contents/" + path:
					if r.URL.Query().Get("ref") != commit {
						t.Error("contents read was not pinned")
					}
					json.NewEncoder(w).Encode(map[string]any{"type": "file", "encoding": "base64", "path": path, "size": len(markdown), "content": base64.StdEncoding.EncodeToString(markdown), "sha": gitBlob(markdown)})
				default:
					http.NotFound(w, r)
				}
			}))
			defer provider.Close()
			s, err := New(db, []store.GitHubRepository{config}, "", Options{BaseURL: provider.URL, Client: provider.Client()})
			if err != nil {
				t.Fatal(err)
			}
			result, err := s.Sync(context.Background())
			if err != nil || result.Imported != 3 || result.Dispatched != 0 || result.Partial {
				t.Fatalf("roadmap sync: %+v %v", result, err)
			}
			page, err := db.Tasks(context.Background(), "", 50, store.TaskFilter{SourceKind: "roadmap"})
			if err != nil || len(page.Tasks) != 3 {
				t.Fatalf("imported tasks: %+v %v", page, err)
			}
			for _, task := range page.Tasks {
				if task.Source.CommitSHA != commit || task.Source.BlobSHA != gitBlob(markdown) || !strings.Contains(task.Source.URL, "/blob/"+commit+"/"+path+"#L") {
					t.Fatal("immutable source link lost")
				}
				if task.Source.ItemID == "parent" && (task.Title != "Parent" || task.Prompt != "Parent. Parent goal #go") {
					t.Fatalf("import lost short title or full goal: %+v", task.Spec)
				}
				if task.Source.ItemID == "child" && (task.Source.Depth != 1 || task.ParentTaskID == "" || task.Source.ParentItemID != "parent") {
					t.Fatal("nested hierarchy metadata lost")
				}
			}
			// Pinning a different file commit/line shift changes navigation, not item revisions.
			commit = strings.Repeat("b", 40)
			markdown = append([]byte("\n"), markdown...)
			result, err = s.Sync(context.Background())
			if err != nil || result.Imported != 0 || result.Updated != 0 {
				t.Fatalf("metadata-only sync: %+v %v", result, err)
			}
		})
	}
}

func TestRepositoryRoadmapParsesWithoutDiscardingCheckboxes(t *testing.T) {
	data, err := os.ReadFile("../../../ROADMAP.md")
	if err != nil {
		t.Fatal(err)
	}
	parsed := ParseRoadmap(data)
	if parsed.Partial || len(parsed.Items) < 100 {
		t.Fatalf("repository roadmap incomplete items=%d errors=%v", len(parsed.Items), parsed.Errors)
	}
	db := database(t)
	config := config()
	snapshot := store.RoadmapSnapshot{RepositoryID: "200", Repository: "acme/repo", Path: "ROADMAP.md", CommitSHA: strings.Repeat("a", 40), BlobSHA: gitBlob(data), Items: []store.RoadmapItem{}}
	for _, item := range parsed.Items {
		snapshot.Items = append(snapshot.Items, store.RoadmapItem{ID: item.ID, ParentID: item.ParentID, Title: item.Title, Text: item.Text, Checked: item.Checked, Line: item.Line, Headings: item.Headings, Tags: item.Tags})
	}
	result, err := db.SyncRoadmap(context.Background(), config, snapshot)
	if err != nil || result.Imported != len(parsed.Items) {
		t.Fatalf("repository todo import: %+v %v", result, err)
	}
	issue := store.GitHubIssue{RepositoryID: "200", Repository: "acme/repo", ID: "900", NodeID: "I_900", Number: 9, URL: "https://github.com/acme/repo/issues/9", Title: "Independent Issue", Body: "Issue goal", State: "open", UpdatedAt: "2026-10-28T00:00:00Z", Labels: []string{"triage"}}
	if _, err = db.SyncGitHubIssue(context.Background(), config, issue); err != nil {
		t.Fatal(err)
	}
	client, _, err := db.CreateClient(context.Background(), "Reader", []string{"project"})
	if err != nil {
		t.Fatal(err)
	}
	issues, err := db.ClientTasks(context.Background(), &client, "", 50, store.TaskFilter{SourceKind: "github"})
	if err != nil || len(issues.Tasks) != 1 || issues.Tasks[0].Source.IssueNumber != 9 || issues.Tasks[0].Tags[0] != "triage" {
		t.Fatalf("large roadmap hid separate Issue intake: %+v %v", issues, err)
	}
	count, checked, cursor := 0, 0, ""
	for {
		page, err := db.ClientTasks(context.Background(), &client, cursor, 50, store.TaskFilter{SourceKind: "roadmap"})
		if err != nil {
			t.Fatal(err)
		}
		for _, task := range page.Tasks {
			if count >= len(parsed.Items) || task.LatestSource.Line != parsed.Items[count].Line {
				t.Fatalf("repository document order lost across page: index=%d line=%d", count, task.LatestSource.Line)
			}
			count++
			if task.Source.State == "closed" {
				checked++
			}
			if task.Run != nil {
				t.Fatal("repository roadmap item auto-executed")
			}
		}
		if !page.HasMore {
			break
		}
		cursor = *page.NextCursor
	}
	wantChecked := 0
	for _, item := range parsed.Items {
		if item.Checked {
			wantChecked++
		}
	}
	if count != len(parsed.Items) || checked != wantChecked {
		t.Fatalf("repository denominator parsed=%d imported=%d checked=%d want=%d", len(parsed.Items), count, checked, wantChecked)
	}
}
