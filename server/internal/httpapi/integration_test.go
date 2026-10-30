package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/phodal/pero/server/internal/httpapi"
	"github.com/phodal/pero/server/internal/store"
)

func testAPI(t *testing.T, setup ...func(*store.Store) http.Handler) *httptest.Server {
	t.Helper()
	dsn := os.Getenv("PERO_TEST_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("PERO_REQUIRE_TEST_DATABASE") == "1" {
			t.Fatal("PERO_TEST_DATABASE_URL is required for PostgreSQL acceptance")
		}
		t.Skip("set PERO_TEST_DATABASE_URL to exercise real PostgreSQL HTTP API")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "api_test_" + strings.ReplaceAll(time.Now().UTC().Format("20060102150405.000000000"), ".", "")
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
	handler := httpapi.Handler(db, "test-operator")
	if len(setup) > 0 {
		handler = setup[0](db)
	}
	server := httptest.NewServer(handler)
	t.Cleanup(func() {
		server.Close()
		db.Close()
		_, _ = admin.Exec(ctx, "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE")
		admin.Close()
	})
	return server
}

func request(t *testing.T, server *httptest.Server, method, path, token string, body any, key string, status int) []byte {
	t.Helper()
	var data []byte
	if raw, ok := body.(string); ok {
		data = []byte(raw)
	} else if body != nil {
		data, _ = json.Marshal(body)
	}
	req, err := http.NewRequest(method, server.URL+path, bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	result, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != status {
		t.Fatalf("%s %s returned %d, want %d: %s", method, path, response.StatusCode, status, result)
	}
	if response.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("sensitive API responses must not be cached")
	}
	return result
}
func parse[T any](t *testing.T, data []byte) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestAuthenticatedRemoteLifecycle(t *testing.T) {
	server := testAPI(t)
	request(t, server, "GET", "/healthz", "", nil, "", 200)
	request(t, server, "GET", "/api/v1/tasks", "", nil, "", 401)
	request(t, server, "GET", "/api/v1/tasks", "wrong", nil, "", 401)
	request(t, server, "POST", "/api/v1/tasks", "test-operator", `null`, "", 400)
	request(t, server, "POST", "/api/v1/tasks", "test-operator", `{} {}`, "", 400)
	request(t, server, "POST", "/api/v1/tasks", "test-operator", `{"unknown":true}`, "", 400)
	request(t, server, "POST", "/api/v1/tasks", "test-operator", strings.Repeat(" ", 600*1024), "", 400)
	provision := map[string]any{"name": "fixture runner", "projects": []string{"project"}}
	worker := parse[struct {
		Worker store.Worker `json:"worker"`
		Token  string       `json:"token"`
	}](t, request(t, server, "POST", "/api/v1/workers", "test-operator", provision, "", 201))
	if worker.Token == "" || worker.Worker.Labels == nil {
		t.Fatal("provisioning requires a token and non-null labels")
	}
	request(t, server, "GET", "/api/v1/tasks", worker.Token, nil, "", 401)
	request(t, server, "POST", "/api/worker/v1/claims", "test-operator", map[string]string{"request_id": "claim", "instance_id": "instance"}, "", 401)
	workers := request(t, server, "GET", "/api/v1/workers", "test-operator", nil, "", 200)
	if bytes.Contains(workers, []byte("token")) {
		t.Fatal("worker listing exposed credentials")
	}
	spec := store.Spec{Title: "Fixture", Prompt: "Produce a result", Acceptance: "Record inspectable output", ProjectID: "project", WorkspaceKey: "repo", AgentID: "fixture"}
	task := parse[store.Task](t, request(t, server, "POST", "/api/v1/tasks", "test-operator", spec, "create", 201))
	duplicate := parse[store.Task](t, request(t, server, "POST", "/api/v1/tasks", "test-operator", spec, "create", 201))
	if duplicate.ID != task.ID {
		t.Fatal("lost create response duplicated task")
	}
	run := parse[store.Run](t, request(t, server, "POST", "/api/v1/tasks/"+task.ID+"/dispatch", "test-operator", map[string]string{"worker_id": worker.Worker.ID}, "dispatch", 200))
	claim := parse[struct {
		Run *store.Run `json:"run"`
	}](t, request(t, server, "POST", "/api/worker/v1/claims", worker.Token, map[string]string{"request_id": "claim", "instance_id": "instance"}, "", 200))
	if claim.Run == nil || claim.Run.ID != run.ID || claim.Run.LeaseExpiresAt == nil {
		t.Fatal("missing bound Run lease")
	}
	base := "/api/worker/v1/runs/" + run.ID
	request(t, server, "GET", base+"?instance_id=instance", worker.Token, nil, "", 200)
	request(t, server, "GET", base+"?instance_id=other", worker.Token, nil, "", 403)
	batch := map[string]any{"generation": run.Generation, "instance_id": "instance", "events": []store.Event{{Seq: 1, Kind: "message", Text: "fixture running"}}}
	request(t, server, "POST", base+"/events", worker.Token, batch, "", 200)
	request(t, server, "POST", base+"/events", worker.Token, batch, "", 200)
	detail := parse[struct {
		Task   store.Task    `json:"task"`
		Run    *store.Run    `json:"run"`
		Events []store.Event `json:"events"`
	}](t, request(t, server, "GET", "/api/v1/tasks/"+task.ID, "test-operator", nil, "", 200))
	if detail.Task.State != "running" || len(detail.Events) != 1 || detail.Run.ID != run.ID {
		t.Fatal("task progress was not persisted")
	}
	request(t, server, "POST", "/api/v1/tasks/"+task.ID+"/cancel", "test-operator", nil, "", 200)
	renew := map[string]any{"generation": run.Generation, "instance_id": "instance"}
	receipt := parse[struct {
		Cancel bool `json:"cancel_requested"`
	}](t, request(t, server, "POST", base+"/renew", worker.Token, renew, "", 200))
	if !receipt.Cancel {
		t.Fatal("worker did not receive cancellation")
	}
	done := map[string]any{"generation": run.Generation, "instance_id": "instance", "outcome": "cancelled", "summary": "process stopped"}
	request(t, server, "POST", base+"/complete", worker.Token, done, "", 200)
	request(t, server, "POST", base+"/complete", worker.Token, done, "", 200)
	done["summary"] = "conflicting receipt"
	request(t, server, "POST", base+"/complete", worker.Token, done, "", 409)
	final := parse[struct {
		Task store.Task `json:"task"`
	}](t, request(t, server, "GET", "/api/v1/tasks/"+task.ID, "test-operator", nil, "", 200))
	if final.Task.State != "cancelled" {
		t.Fatal("cancel acknowledgement was not reflected")
	}
}

func TestUnicodeLimitsAndByteBoundedTaskPages(t *testing.T) {
	server := testAPI(t)
	spec := store.Spec{Title: strings.Repeat("研", 240), Prompt: strings.Repeat("任务", 32000), Acceptance: strings.Repeat("核", 16000), ProjectID: "project", WorkspaceKey: "repo", AgentID: "fixture"}
	for i := 0; i < 3; i++ {
		request(t, server, "POST", "/api/v1/tasks", "test-operator", spec, "", 201)
	}
	data := request(t, server, "GET", "/api/v1/tasks?limit=50", "test-operator", nil, "", 200)
	page := parse[store.TaskPage](t, data)
	if len(data) > 512*1024 || len(page.Tasks) != 2 || !page.HasMore || page.NextCursor == nil {
		t.Fatalf("page budget size=%d rows=%d more=%v", len(data), len(page.Tasks), page.HasMore)
	}
	next := parse[store.TaskPage](t, request(t, server, "GET", "/api/v1/tasks?cursor="+url.QueryEscape(*page.NextCursor), "test-operator", nil, "", 200))
	if len(next.Tasks) != 1 || next.HasMore || next.NextCursor != nil {
		t.Fatalf("remaining page: rows=%d more=%v", len(next.Tasks), next.HasMore)
	}
	spec.Title += "研"
	request(t, server, "POST", "/api/v1/tasks", "test-operator", spec, "", 400)
	request(t, server, "GET", "/api/v1/tasks?limit=51", "test-operator", nil, "", 400)
}
