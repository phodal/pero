package community

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/store"
)

// A new OAuth identity and a public GitHub source, without project grants or an
// assigned Worker. The Electron suite exercises the production API/Host path.
func TestContributorDesktopFixture(t *testing.T) {
	file := os.Getenv("PERO_CONTRIBUTOR_DESKTOP_FIXTURE")
	if file == "" {
		t.Skip("contributor Desktop fixture is opt-in")
	}
	f := communityHTTP(t)
	// The first registration loses its response path after the GitHub operation;
	// Desktop must preserve the known PR and retry only evidence registration.
	var failRegistration atomic.Bool
	failRegistration.Store(true)
	handler := f.app.Config.Handler
	f.app.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/pull-request") && failRegistration.Swap(false) {
			http.Error(w, "fixture registration temporarily unavailable", http.StatusServiceUnavailable)
			return
		}
		handler.ServeHTTP(w, r)
	})
	ctx := context.Background()
	config := store.GitHubRepository{ProjectID: "public", Owner: "acme", Repo: "repo", WorkspaceKey: "private-workspace", AgentID: "fixture", Acceptance: "Private operator acceptance configuration"}
	if err := f.db.BindGitHubRepository(ctx, config, "900", false); err != nil {
		t.Fatal(err)
	}
	issue := store.GitHubIssue{RepositoryID: "900", Repository: "acme/repo", ID: "901", NodeID: "I_fixture_901", Number: 9,
		URL: "https://github.com/acme/repo/issues/9", Title: "Add contributor documentation", Body: "contribution-fixture: add CONTRIBUTOR.md to document the local workflow.",
		State: "open", UpdatedAt: "2026-10-28T00:00:00Z", Labels: []string{"good first issue"}}
	if _, err := f.db.SyncGitHubIssue(ctx, config, issue); err != nil {
		t.Fatal(err)
	}
	page, err := f.db.Tasks(ctx, "", 50)
	if err != nil {
		t.Fatal(err)
	}
	taskID := ""
	for _, task := range page.Tasks {
		if task.Source != nil && task.Source.IssueID == issue.ID {
			taskID = task.ID
		}
	}
	if taskID == "" {
		t.Fatal("public source task was not imported")
	}
	metadata, err := json.Marshal(map[string]string{"url": f.app.URL, "task": taskID, "private_task": f.taskID})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(file, metadata, 0600); err != nil {
		t.Fatal(err)
	}
	deadline := time.NewTimer(8 * time.Minute)
	defer deadline.Stop()
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-deadline.C:
			t.Fatal("contributor Desktop fixture timed out")
		case <-tick.C:
			if _, err = os.Stat(file + ".stop"); err == nil {
				return
			}
		}
	}
}
