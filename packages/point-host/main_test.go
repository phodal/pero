package main

import (
	"encoding/json"
	"testing"
)

// Reopen the actual durable store on each request, as the private Host does.
func TestProjectProtocol(t *testing.T) {
	root := t.TempDir()
	call := func(method, path, body string, headers map[string]string) Response {
		t.Helper()
		r, err := execute(root, "", Request{Method: method, Path: path, Body: json.RawMessage(body), Headers: headers})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	create := call("POST", "/api/projects", `{"title":"Research","typeId":"software"}`, map[string]string{"Idempotency-Key": "create-project-1"})
	if create.Status != 201 {
		t.Fatalf("create: %+v", create)
	}
	encoded, _ := json.Marshal(create.Body)
	var state struct {
		Project struct {
			ID       string `json:"id"`
			Revision uint64 `json:"revision"`
			Brief    string `json:"brief"`
		} `json:"project"`
	}
	if err := json.Unmarshal(encoded, &state); err != nil {
		t.Fatal(err)
	}
	if state.Project.Revision != 1 || state.Project.ID == "" {
		t.Fatalf("state: %s", encoded)
	}
	path := "/api/projects/" + state.Project.ID
	if got := call("GET", path, "", nil); got.Status != 200 || got.Headers["ETag"] != `"1"` {
		t.Fatalf("reopen: %+v", got)
	}
	if got := call("POST", path+"/context", `{"brief":"checked inputs"}`, map[string]string{"Idempotency-Key": "context-update-1", "If-Match": `"1"`}); got.Status != 200 {
		t.Fatalf("context: %+v", got)
	}
	if got := call("POST", path+"/context", `{"brief":"stale write"}`, map[string]string{"Idempotency-Key": "context-update-2", "If-Match": `"1"`}); got.Status != 409 {
		t.Fatalf("stale: %+v", got)
	}
	if got := call("GET", path+"/revisions/1", "", nil); got.Status != 200 {
		t.Fatalf("revision: %+v", got)
	}
	if got := call("POST", "/api/projects", `{"title":"Invalid workspace","typeId":"software","workspaceId":"caller-path"}`, map[string]string{"Idempotency-Key": "create-project-2"}); got.Status != 400 {
		t.Fatalf("unregistered workspace: %+v", got)
	}
	if got := call("POST", "/api/projects", `{"title":"Repositories","typeId":"software","repositories":[{}]}`, map[string]string{"Idempotency-Key": "create-project-3"}); got.Status != 501 {
		t.Fatalf("unresolved repo: %+v", got)
	}
	if got := call("GET", path+"/hub", "", nil); got.Status != 200 {
		t.Fatalf("local ownership: %+v", got)
	}
	if got := call("POST", path+"/runs", `{}`, nil); got.Status != 501 {
		t.Fatalf("unsupported execution: %+v", got)
	}
}
