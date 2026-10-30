package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/phodal/pero/server/internal/github"
	"github.com/phodal/pero/server/internal/httpapi"
	"github.com/phodal/pero/server/internal/store"
)

func TestGitHubSourceEndpointsRemainOperatorOnly(t *testing.T) {
	dsn := os.Getenv("PERO_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set PERO_TEST_DATABASE_URL for GitHub source HTTP acceptance")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "github_api_" + strconv.FormatInt(time.Now().UnixNano(), 10)
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(dsn)
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := store.Open(ctx, u.String(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Close()
		_, _ = admin.Exec(ctx, "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE")
		admin.Close()
	})
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/acme/repo" {
			w.Write([]byte(`{"id":200,"full_name":"acme/repo"}`))
			return
		}
		w.Write([]byte(`[{"id":300,"node_id":"I_300","number":7,"title":"Issue","body":"Goal","state":"open","html_url":"https://github.com/acme/repo/issues/7","updated_at":"2026-10-28T00:00:00Z","labels":[]}]`))
	}))
	defer provider.Close()
	service, err := github.New(db, []store.GitHubRepository{{ProjectID: "project", Owner: "acme", Repo: "repo", WorkspaceKey: "repo", AgentID: "fixture", Acceptance: "Inspect result"}}, "private-token", github.Options{BaseURL: provider.URL, Client: provider.Client()})
	if err != nil {
		t.Fatal(err)
	}
	// Enabling the isolated runtime transport must not silently drop the
	// existing source service from the ordinary authenticated API.
	isolated := httptest.NewServer(httpapi.HandlerWithIsolatedRuntime(db, "test-operator", nil, nil, nil, nil, service))
	defer isolated.Close()
	isolatedStatus := request(t, isolated, "GET", "/api/v1/github/status", "test-operator", nil, "", 200)
	var isolatedDecoded github.Status
	if json.Unmarshal(isolatedStatus, &isolatedDecoded) != nil || !isolatedDecoded.Configured || len(isolatedDecoded.Repositories) != 1 {
		t.Fatalf("isolated source composition lost service: %s", isolatedStatus)
	}
	server := httptest.NewServer(httpapi.Handler(db, "test-operator", service))
	defer server.Close()
	_, clientToken, err := db.CreateClient(ctx, "Reader", []string{"project"})
	if err != nil {
		t.Fatal(err)
	}
	request(t, server, "GET", "/api/v1/github/status", clientToken, nil, "", 401)
	clientStatus := request(t, server, "GET", "/api/client/v1/github/status", clientToken, nil, "", 200)
	var scoped github.Status
	if err = json.Unmarshal(clientStatus, &scoped); err != nil || len(scoped.Repositories) != 1 || scoped.Repositories[0].ProjectID != "project" {
		t.Fatalf("client source status: %s %v", clientStatus, err)
	}
	_, foreignToken, err := db.CreateClient(ctx, "Foreign", []string{"hidden"})
	if err != nil {
		t.Fatal(err)
	}
	privateStatus := request(t, server, "GET", "/api/client/v1/github/status", foreignToken, nil, "", 200)
	if strings.Contains(string(privateStatus), "acme") || strings.Contains(string(privateStatus), "private-token") {
		t.Fatalf("source status leaked repository: %s", privateStatus)
	}
	request(t, server, "POST", "/api/v1/github/sync", clientToken, map[string]any{}, "", 401)
	status := request(t, server, "GET", "/api/v1/github/status", "test-operator", nil, "", 200)
	var decoded github.Status
	if err = json.Unmarshal(status, &decoded); err != nil || !decoded.Configured || len(decoded.Repositories) != 1 {
		t.Fatalf("source status: %s %v", status, err)
	}
	result := request(t, server, "POST", "/api/v1/github/sync", "test-operator", map[string]any{}, "", 200)
	var imported github.Result
	if err = json.Unmarshal(result, &imported); err != nil || imported.Imported != 1 || imported.Dispatched != 0 {
		t.Fatalf("source sync: %s %v", result, err)
	}
	filtered := request(t, server, "GET", "/api/client/v1/tasks?source_kind=roadmap", clientToken, nil, "", 200)
	var page store.TaskPage
	if err = json.Unmarshal(filtered, &page); err != nil || len(page.Tasks) != 0 {
		t.Fatalf("source filter ignored: %s %v", filtered, err)
	}
	request(t, server, "GET", "/api/client/v1/tasks?source_kind=invalid", clientToken, nil, "", 400)
}
