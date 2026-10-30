package sandbox_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/server/internal/httpapi"
	"github.com/phodal/pero/server/internal/runtimebinding"
	"github.com/phodal/pero/server/internal/sandbox"
	"github.com/phodal/pero/server/internal/store"
)

func TestRuntimeOperatorHTTPAndExplicitProviderCredentials(t *testing.T) {
	db := isolatedStore(t)
	config, workerToken := workerConfig(t, db)
	k, _ := newKube(t, config)
	_, clientToken, err := db.CreateClient(t.Context(), "fixture client", []string{"fixture"})
	if err != nil {
		t.Fatal(err)
	}
	k.requiredToken = "synthetic-controller-token"
	private := t.TempDir()
	tokenFile := filepath.Join(private, "controller-token")
	if err := os.WriteFile(tokenFile, []byte(k.requiredToken), 0600); err != nil {
		t.Fatal(err)
	}
	configFile := filepath.Join(private, "runtime.json")
	writeJSON(t, configFile, sandbox.FileConfig{Runtime: config, APIURL: k.apiURL, TokenFile: tokenFile})
	runtime, err := sandbox.FromFile(t.Context(), db, configFile)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(httpapi.HandlerWithSandbox(db, "synthetic-operator", runtime))
	defer server.Close()
	task := task(t, db, "HTTP admission fixture")
	path := "/api/v1/tasks/" + task.ID + "/runtime-dispatch"
	request := func(method, path, token, key, body string) (int, []byte) {
		t.Helper()
		req, err := http.NewRequestWithContext(t.Context(), method, server.URL+path, bytes.NewBufferString(body))
		if err != nil {
			t.Fatal(err)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		req.Header.Set("Content-Type", "application/json")
		response, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, data
	}
	for _, test := range []struct {
		name, token, key, body string
		code                   int
	}{
		{"unauthenticated", "", "dispatch", "{}", 401},
		{"worker credential", workerToken, "dispatch", "{}", 401},
		{"client credential", clientToken, "dispatch", "{}", 401},
		{"missing operation identity", "synthetic-operator", "", "{}", 400},
		{"task supplied pool", "synthetic-operator", "dispatch", `{"pool":"unapproved"}`, 400},
		{"task supplied image", "synthetic-operator", "dispatch", `{"image":"unapproved"}`, 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			code, _ := request(http.MethodPost, path, test.token, test.key, test.body)
			if code != test.code {
				t.Fatalf("HTTP %d, want %d", code, test.code)
			}
		})
	}
	k.change(func(k *kubeFixture) {
		if k.posts != 0 {
			t.Errorf("rejected requests provisioned %d claims", k.posts)
		}
	})
	var first, repeat struct {
		Run     store.Run              `json:"run"`
		Runtime runtimebinding.Binding `json:"runtime"`
	}
	for _, target := range []any{&first, &repeat} {
		code, data := request(http.MethodPost, path, "synthetic-operator", "dispatch", "{}")
		if code != 202 {
			t.Fatalf("dispatch HTTP %d: %s", code, data)
		}
		if err := json.Unmarshal(data, target); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), "synthetic-controller-token") || strings.Contains(string(data), workerToken) {
			t.Fatal("credential leaked to runtime response")
		}
	}
	if first.Run.ID == "" || first.Run.ID != repeat.Run.ID || repeat.Runtime.Phase != runtimebinding.Ready || repeat.Runtime.Config != config {
		t.Fatalf("HTTP dispatch changed identity/config: first=%+v repeat=%+v", first, repeat)
	}
	k.change(func(k *kubeFixture) {
		if k.posts != 1 {
			t.Errorf("HTTP retry recreated claim %d times", k.posts)
		}
		policy := k.objects[k.claimPath]["spec"].(map[string]any)["lifecycle"].(map[string]any)["shutdownPolicy"]
		if policy != "DeleteForeground" {
			t.Errorf("FromFile lifecycle policy=%v", policy)
		}
	})
	code, data := request(http.MethodGet, "/api/v1/runs/"+first.Run.ID+"/runtime", "synthetic-operator", "", "")
	if code != 200 {
		t.Fatalf("binding HTTP %d: %s", code, data)
	}
	code, data = request(http.MethodPost, "/api/v1/runs/"+first.Run.ID+"/runtime/release", "synthetic-operator", "", "{}")
	if code != 202 {
		t.Fatalf("release HTTP %d: %s", code, data)
	}
	var released runtimebinding.Binding
	if err := json.Unmarshal(data, &released); err != nil || released.Phase != runtimebinding.Released {
		t.Fatalf("release=%+v %v", released, err)
	}
	retained, err := db.RuntimeRun(t.Context(), first.Run.ID)
	if err != nil || retained.Status != "cancelled" {
		t.Fatalf("queued cancellation lost: %+v %v", retained, err)
	}
}
