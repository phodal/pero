package httpapi_test

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/environments/model"
	"github.com/phodal/pero/server/internal/httpapi"
	"github.com/phodal/pero/server/internal/runtimeauth"
	"github.com/phodal/pero/server/internal/runtimebinding"
	"github.com/phodal/pero/server/internal/runtimechannel"
	"github.com/phodal/pero/server/internal/runtimegateway"
	"github.com/phodal/pero/server/internal/store"
)

func TestCloudBrowserFollowsClaimAndRuntimeChannel(t *testing.T) {
	const podToken = "fixture-pod-token"
	const wrongPodToken = "wrong-pod-token"
	reviews := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Spec struct {
				Token     string
				Audiences []string
			}
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil || len(input.Spec.Audiences) != 1 || input.Spec.Audiences[0] != runtimechannel.Audience {
			t.Error("missing online TokenReview for the runtime audience")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		pod := "pod-one"
		switch input.Spec.Token {
		case podToken:
		case wrongPodToken:
			pod = "pod-two"
		default:
			w.WriteHeader(http.StatusForbidden)
			return
		}
		fmt.Fprintf(w, `{"status":{"authenticated":true,"audiences":[%q],"user":{"username":"system:serviceaccount:fixture:agent","uid":"sa-one","extra":{"authentication.kubernetes.io/pod-uid":[%q]}}}}`, runtimechannel.Audience, pod)
	}))
	defer reviews.Close()
	reviewer, err := runtimeauth.New(reviews.URL, reviews.Client())
	if err != nil {
		t.Fatal(err)
	}
	budget := runtimechannel.ProviderBudget{MaxRequests: 1, MaxConcurrent: 1, MaxOutputTokens: 64, MaxRequestBytes: 1024, MaxResponseBytes: 1024, TimeoutSeconds: 5}
	var db *store.Store
	server := testAPI(t, func(s *store.Store) http.Handler {
		db = s
		gateway, err := runtimegateway.New(s, reviewer, runtimegateway.ProviderConfig{Endpoint: reviews.URL + "/chat/completions", Model: "fixture", APIKey: "fixture", Budget: budget})
		if err != nil {
			t.Fatal(err)
		}
		return httpapi.HandlerWithIsolatedRuntime(s, "test-operator", nil, gateway, reviewer, nil)
	})
	electronFixture := os.Getenv("PERO_TEST_CLOUD_BROWSER_ELECTRON")
	timeout := 15 * time.Second
	if electronFixture != "" {
		timeout = 2 * time.Minute
	}
	ctx, cancel := context.WithTimeout(t.Context(), timeout)
	defer cancel()
	owner, ownerToken, err := db.CreateClient(ctx, "Desktop owner", []string{"p"})
	if err != nil {
		t.Fatal(err)
	}
	_, peerToken, err := db.CreateClient(ctx, "Same project", []string{"p"})
	if err != nil {
		t.Fatal(err)
	}
	worker, _, err := db.CreateWorker(ctx, "Worker", []string{"p"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	config := runtimebinding.Config{
		Profile: runtimechannel.Profile, ClusterID: "fixture", Namespace: "fixture",
		WorkerID: worker.ID, ProjectID: "p", WorkspaceKey: "repo", AgentID: "fixture",
		ImageDigest: "sha256:" + strings.Repeat("a", 64), TemplateDigest: "sha256:" + strings.Repeat("b", 64),
		WorkspaceRevision: strings.Repeat("c", 40), TTLSeconds: 3600, RuntimeClass: "runsc",
		ServiceAccount: "agent", ServiceAccountUID: "sa-one", Audience: runtimechannel.Audience,
		ControlURL: "https://fixture.invalid", ImageRef: "fixture@sha256:" + strings.Repeat("a", 64),
		Model: "fixture", StorageClass: "retained", StorageAccessMode: "ReadWriteOnce", VolumeSize: "1Gi",
	}
	if err = db.ConfigureRuntimeWorker(ctx, config); err != nil {
		t.Fatal(err)
	}
	task, err := db.CreateTask(ctx, store.Spec{Title: "Browser fixture", Prompt: "Observe fixture", Acceptance: "Read fixture", ProjectID: "p", WorkspaceKey: "repo", AgentID: "fixture"}, "create")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ClaimTask(ctx, &owner, task.ID); err != nil {
		t.Fatal(err)
	}
	run, binding, _, err := db.DispatchRuntime(ctx, task.ID, "dispatch", config)
	if err != nil {
		t.Fatal(err)
	}
	sandbox := model.ResourceRef{Owner: model.Owner{Kind: "kubernetes", ID: config.ClusterID}, Kind: "kubernetes.sandbox", Scope: config.Namespace, ID: "sandbox", Incarnation: "uid"}
	bound, err := binding.WithResource(sandbox)
	if err != nil {
		t.Fatal(err)
	}
	pvc := model.ResourceRef{Owner: sandbox.Owner, Kind: "kubernetes.pvc", Scope: sandbox.Scope, ID: "volume", Incarnation: "pvc-uid"}
	bound, err = bound.WithVolume(runtimebinding.VolumeBinding{Resource: pvc, VolumeName: "pv-fixture", ProviderDigest: "sha256:" + strings.Repeat("d", 64)})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	expiry := now.Add(time.Hour)
	bound = bound.Observe(model.Observation{
		Resource: sandbox, Runtime: &model.Ref{Kind: "kubernetes-runtime", ID: "pod-one", Digest: "sha256:" + strings.Repeat("d", 64)},
		Receipt:    model.Ref{Kind: "kubernetes-observation", ID: sandbox.Incarnation, Revision: "1"},
		ObservedAt: now, Ready: model.Condition{Status: "True", Reason: "FixtureReady"}, LeaseExpiresAt: &expiry,
		Artifacts: []model.Ref{{Kind: "container-image", ID: config.ImageRef, Revision: "agent", Digest: config.ImageDigest}},
	}, now)
	if _, err = db.SaveRuntimeBinding(ctx, bound.Version, bound); err != nil {
		t.Fatal(err)
	}
	run, err = db.Claim(ctx, worker.ID, "instance", "worker-claim")
	if err != nil || run == nil {
		t.Fatal("claim runtime", run, err)
	}
	secret := strings.Repeat("e", 64)
	if _, err := db.ReserveRuntimeChannel(ctx, run.ID, worker.ID, run.InstanceID, run.Generation, run.ID, secret, budget); err != nil {
		t.Fatal(err)
	}
	path := func(route string) string { return "/api/runtime/v1/runs/" + run.ID + route + "?session_id=" + run.ID }
	attach := func(route, token string, want int) (*http.Response, *io.PipeWriter) {
		t.Helper()
		reader, writer := io.Pipe()
		t.Cleanup(func() { writer.Close() })
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+path(route), reader)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/x-ndjson")
		response, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { response.Body.Close() })
		if response.StatusCode != want {
			t.Fatalf("%s returned %d, want %d", route, response.StatusCode, want)
		}
		return response, writer
	}
	attach("/channel/worker", run.ID+"."+secret, http.StatusOK)
	attach("/channel/agent", podToken, http.StatusOK)
	callPath := path("/browser/call")
	request(t, server, "POST", callPath, wrongPodToken, `{"action":"observe"}`, "", http.StatusForbidden)
	request(t, server, "POST", callPath, podToken, `{"action":"observe"}`, "", http.StatusConflict)
	if electronFixture != "" {
		if !filepath.IsAbs(electronFixture) {
			t.Fatal("PERO_TEST_CLOUD_BROWSER_ELECTRON must name an absolute fixture path")
		}
		cmd := exec.CommandContext(ctx, "node", electronFixture)
		cmd.Env = append(os.Environ(),
			"PERO_TEST_CLOUD_BROWSER_ORIGIN="+server.URL, "PERO_TEST_CLOUD_BROWSER_CLIENT="+ownerToken,
			"PERO_TEST_CLOUD_BROWSER_POD="+podToken, "PERO_TEST_CLOUD_BROWSER_RUN="+run.ID,
			"PERO_TEST_CLOUD_BROWSER_TASK="+task.ID)
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("Electron fixture failed: %v\n%s", err, output)
		}
		t.Logf("%s", output)
	}
	attach("/browser/desktop", peerToken, http.StatusForbidden)
	desktop, writer := attach("/browser/desktop", ownerToken, http.StatusOK)
	attach("/browser/desktop", ownerToken, http.StatusConflict)

	type outcome struct {
		status int
		value  string
		err    error
	}
	call := func(arguments string) <-chan outcome {
		done := make(chan outcome, 1)
		go func() {
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+callPath, strings.NewReader(arguments))
			if err != nil {
				done <- outcome{err: err}
				return
			}
			req.Header.Set("Authorization", "Bearer "+podToken)
			req.Header.Set("Content-Type", "application/json")
			response, err := server.Client().Do(req)
			if err != nil {
				done <- outcome{err: err}
				return
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			done <- outcome{status: response.StatusCode, value: string(body), err: err}
		}()
		return done
	}
	receive := bufio.NewReader(desktop.Body)
	first := call(`{"action":"observe"}`)
	if line, err := receive.ReadString('\n'); err != nil || line != "{\"id\":1,\"value\":{\"action\":\"observe\"}}\n" {
		t.Fatal("Desktop observed unexpected request", line, err)
	}
	request(t, server, "POST", callPath, podToken, `{"action":"observe"}`, "", http.StatusConflict)
	if _, err = io.WriteString(writer, "{\"id\":1,\"value\":{\"title\":\"fixture\"}}\n"); err != nil {
		t.Fatal(err)
	}
	if result := <-first; result.err != nil || result.status != http.StatusOK || result.value != `{"title":"fixture"}` {
		t.Fatal("Agent got unexpected result", result)
	}

	inFlight := call(`{"action":"click","ref":"fixture"}`)
	if line, err := receive.ReadString('\n'); err != nil || line != "{\"id\":2,\"value\":{\"action\":\"click\",\"ref\":\"fixture\"}}\n" {
		t.Fatal("Desktop did not receive the in-flight call", line, err)
	}
	if _, err := db.ClientCancel(ctx, &owner, task.ID); err != nil {
		t.Fatal(err)
	}
	if result := <-inFlight; result.err != nil || result.status != http.StatusBadGateway {
		t.Fatal("cancelled result retained an active grant", result)
	}
	if _, err := receive.ReadByte(); err == nil || ctx.Err() != nil {
		t.Fatal("cancelled Desktop stream remained readable", err)
	}
	request(t, server, "POST", callPath, podToken, `{"action":"observe"}`, "", http.StatusForbidden)
}
