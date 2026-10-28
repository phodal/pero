package httpapi_test

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	source "github.com/phodal/pero/server/internal/github"
	"github.com/phodal/pero/server/internal/httpapi"
	"github.com/phodal/pero/server/internal/store"
)

// Explicit joint acceptance; ordinary unit/integration tests never launch Desktop
// or read public GitHub. Provider credentials are never needed for the live case.
func TestDesktopConnectorSources(t *testing.T) {
	if os.Getenv("PERO_DESKTOP_E2E") != "1" {
		t.Skip("set PERO_DESKTOP_E2E=1 for actual Desktop connector acceptance")
	}
	dsn := os.Getenv("PERO_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("PERO_TEST_DATABASE_URL is required for Desktop connector acceptance")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("Node.js is required for Desktop connector acceptance")
	}
	root := desktopTestRoot(t)
	script := filepath.Join(root, "tests/e2e/connector.mjs")
	if _, err = os.Stat(script); err != nil {
		t.Fatal("tests/e2e/connector.mjs is not ready")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := "desktop_connector_" + strconv.FormatInt(time.Now().UnixNano(), 10)
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE"); err != nil {
			t.Errorf("remove connector schema: %v", err)
		}
	}()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := store.Open(ctx, u.String(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, clientToken, err := db.CreateClient(ctx, "Alice", []string{"default"})
	if err != nil {
		t.Fatal(err)
	}
	private, err := db.CreateTask(ctx, store.Spec{Title: "Private connector task", Prompt: "PRIVATE_CONNECTOR_GOAL", Acceptance: "Hidden", ProjectID: "private", WorkspaceKey: "private", AgentID: "fixture"}, "")
	if err != nil {
		t.Fatal(err)
	}
	live := os.Getenv("PERO_CONNECTOR_LIVE") == "1"
	owner, repo := "acme", "repo"
	if live {
		owner, repo = "phodal", "pero"
	}
	config := store.GitHubRepository{ProjectID: "default", Owner: owner, Repo: repo, WorkspaceKey: "default", AgentID: "fixture", Acceptance: "Inspect source goal and execution separately", RoadmapPath: "auto", AutoDispatch: false}
	options := []source.Options{}
	if !live {
		provider := connectorProvider(t)
		defer provider.Close()
		options = append(options, source.Options{BaseURL: provider.URL, Client: provider.Client()})
	}
	service, err := source.New(db, []store.GitHubRepository{config}, "", options...)
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.Sync(ctx)
	if err != nil || first.Partial || first.Dispatched != 0 {
		t.Fatalf("connector source sync incomplete: %+v %v", first, err)
	}
	second, err := service.Sync(ctx)
	if err != nil || second.Partial || second.Imported != 0 || second.Updated != 0 || second.Dispatched != 0 {
		t.Fatalf("duplicate source sync: %+v %v", second, err)
	}
	tasks := []store.Task{}
	cursor := ""
	for {
		page, err := db.Tasks(ctx, cursor, 50)
		if err != nil {
			t.Fatal(err)
		}
		tasks = append(tasks, page.Tasks...)
		if !page.HasMore {
			break
		}
		cursor = *page.NextCursor
	}
	roadmapCount, issueCount, checked := 0, 0, 0
	parent, child, commit, path := "", "", "", ""
	actualLines := []int{}
	for _, task := range tasks {
		if task.Source == nil {
			continue
		}
		if task.CurrentRunID != "" {
			t.Fatal("connector imported source with an execution")
		}
		switch task.Source.Kind {
		case "github":
			issueCount++
		case "roadmap":
			roadmapCount++
			actualLines = append(actualLines, task.Source.Line)
			commit, path = task.Source.CommitSHA, task.Source.Path
			if task.Source.State == "closed" {
				checked++
			}
			if task.Source.ItemID == "parent" {
				parent = task.ID
			}
			if task.Source.ItemID == "child" {
				child = task.ID
			}
		}
	}
	expectedLines, expectedChecked, expectedIssues := []int{3, 4, 5, 7, 8}, 1, 1
	if live {
		if commit == "" || path == "" {
			t.Fatal("live source sync returned no roadmap snapshot")
		}
		data := connectorPinnedContent(t, ctx, owner, repo, commit, path)
		// An independent line ledger deliberately does not call the Markdown parser.
		expectedLines, expectedChecked = connectorLineLedger(data)
		var raw []struct {
			Pull json.RawMessage `json:"pull_request"`
		}
		connectorPublicJSON(t, ctx, "/repos/"+owner+"/"+repo+"/issues", url.Values{"state": {"all"}, "per_page": {"100"}}, &raw)
		if len(raw) >= 100 {
			t.Fatal("live Issue ledger needs explicit pagination before claiming completeness")
		}
		expectedIssues = 0
		for _, issue := range raw {
			if len(issue.Pull) == 0 || string(issue.Pull) == "null" {
				expectedIssues++
			}
		}
	}
	sort.Ints(actualLines)
	if roadmapCount != len(expectedLines) || checked != expectedChecked || issueCount != expectedIssues || fmt.Sprint(actualLines) != fmt.Sprint(expectedLines) {
		t.Fatalf("independent source denominator mismatch: roadmap %d/%d checked%d/%d issues%d/%d", roadmapCount, len(expectedLines), checked, expectedChecked, issueCount, expectedIssues)
	}
	operatorToken := "connector-operator-" + schema
	api := httptest.NewServer(httpapi.Handler(db, operatorToken, service))
	defer api.Close()
	values := map[string]any{"url": api.URL, "client_token": clientToken, "operator_token": operatorToken, "repository": owner + "/" + repo, "live": live, "expected_roadmap_count": len(expectedLines), "expected_issue_count": expectedIssues, "expected_checked_count": expectedChecked, "expected_lines": expectedLines, "commit_sha": commit, "path": path, "expected_tags": []string{"backend", "desktop", "docs", "bug", "connector"}, "parent_task_id": parent, "child_task_id": child, "private_task_id": private.ID}
	if live {
		values["expected_tags"] = []string{}
	}
	encoded, err := json.Marshal(values)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "connector.json")
	if err = os.WriteFile(file, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	commandContext, stop := context.WithTimeout(ctx, 120*time.Second)
	defer stop()
	cmd := exec.CommandContext(commandContext, node, script)
	cmd.Dir = root
	cmd.WaitDelay = 2 * time.Second
	allowed := map[string]bool{"PATH": true, "HOME": true, "TMPDIR": true, "TMP": true, "TEMP": true, "SHELL": true, "LANG": true, "LC_ALL": true, "USER": true, "LOGNAME": true, "DISPLAY": true, "WAYLAND_DISPLAY": true, "XDG_RUNTIME_DIR": true, "PERO_CHROMIUM_PATH": true}
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if allowed[key] {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "PERO_CONNECTOR_E2E_CONFIG="+file)
	stdout, stderr := &desktopBoundedOutput{}, &desktopBoundedOutput{}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	err = cmd.Run()
	for _, output := range []*desktopBoundedOutput{stdout, stderr} {
		value := output.String()
		for _, secret := range []string{operatorToken, clientToken} {
			value = strings.ReplaceAll(value, secret, "[redacted]")
		}
		if value != "" {
			t.Log(value)
		}
	}
	if err != nil {
		t.Fatalf("Desktop connector acceptance failed: %v (deadline: %v)", err, commandContext.Err())
	}
	t.Logf("connector sources verified live=%v roadmap=%d checked=%d issues=%d; no dispatch", live, roadmapCount, checked, issueCount)
}

const connectorMarkdown = "# Project\n## Backend\n- [ ] Parent. Parent execution goal #backend <!--pero:id:parent-->\n  - [ ] Child. Child execution goal #desktop <!--pero:id:child-->\n- [x] Done. Completed execution goal #docs <!--pero:id:done-->\n## Documentation\n- [ ] Guide. Write the guide #docs <!--pero:id:guide-->\n- [ ] Review. Review the backend #backend <!--pero:id:review-->\n```md\n- [ ] Example checkbox\n```\n"

func connectorProvider(t *testing.T) *httptest.Server {
	t.Helper()
	commit := strings.Repeat("a", 40)
	hash := sha1.New()
	fmt.Fprintf(hash, "blob %d\x00", len(connectorMarkdown))
	hash.Write([]byte(connectorMarkdown))
	blob := hex.EncodeToString(hash.Sum(nil))
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.Header.Get("Authorization") != "" {
			t.Error("connector fixture must use credential-free read-only requests")
			http.Error(w, "forbidden", 403)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/repos/acme/repo":
			io.WriteString(w, `{"id":200,"full_name":"acme/repo","default_branch":"main"}`)
		case "/repos/acme/repo/issues":
			io.WriteString(w, `[{"id":300,"node_id":"I_300","number":1,"title":"Connector Issue","body":"Inspect the connector","state":"open","html_url":"https://github.com/acme/repo/issues/1","updated_at":"2026-10-28T00:00:00Z","labels":[{"name":"bug"},{"name":"connector"}]}]`)
		case "/repos/acme/repo/commits/main":
			json.NewEncoder(w).Encode(map[string]string{"sha": commit})
		case "/repos/acme/repo/contents/ROADMAP.md":
			if r.URL.Query().Get("ref") != commit {
				t.Error("fixture contents not pinned to commit")
			}
			json.NewEncoder(w).Encode(map[string]any{"type": "file", "path": "ROADMAP.md", "size": len(connectorMarkdown), "encoding": "base64", "content": base64.StdEncoding.EncodeToString([]byte(connectorMarkdown)), "sha": blob})
		default:
			http.NotFound(w, r)
		}
	}))
}

func connectorPublicJSON(t *testing.T, ctx context.Context, path string, query url.Values, target any) {
	t.Helper()
	u := url.URL{Scheme: "https", Host: "api.github.com", Path: path, RawQuery: query.Encode()}
	request, err := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2026-03-10")
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal("independent public GitHub read failed")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("independent public GitHub read returned%d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 2*1024*1024+1))
	if err != nil || len(body) > 2*1024*1024 {
		t.Fatal("independent public read exceeded budget")
	}
	if err = json.Unmarshal(body, target); err != nil {
		t.Fatal(err)
	}
}
func connectorPinnedContent(t *testing.T, ctx context.Context, owner, repo, commit, path string) []byte {
	t.Helper()
	var value struct {
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
	}
	connectorPublicJSON(t, ctx, "/repos/"+owner+"/"+repo+"/contents/"+path, url.Values{"ref": {commit}}, &value)
	if value.Encoding != "base64" {
		t.Fatal("independent roadmap read was not base64")
	}
	data, err := base64.StdEncoding.DecodeString(value.Content)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
func connectorLineLedger(data []byte) ([]int, int) {
	checkbox := regexp.MustCompile(`^[\t ]*(?:[-+*]|[0-9]+[.)])[\t ]+\[([ xX])\][\t ]+`)
	lines := []int{}
	checked := 0
	for i, line := range strings.Split(string(data), "\n") {
		if match := checkbox.FindStringSubmatch(line); match != nil {
			lines = append(lines, i+1)
			if match[1] != " " {
				checked++
			}
		}
	}
	return lines, checked
}
