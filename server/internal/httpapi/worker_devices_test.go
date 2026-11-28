package httpapi_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/phodal/pero/server/internal/store"
)

func TestDesktopWorkerEnrollmentAndOwnership(t *testing.T) {
	api := testAPI(t)
	type clientCredentials struct {
		Client store.Client `json:"client"`
		Token  string       `json:"token"`
	}
	alice := parse[clientCredentials](t, request(t, api, "POST", "/api/v1/clients", "test-operator", map[string]any{"name": "Alice", "projects": []string{"team"}}, "", 201))
	bob := parse[clientCredentials](t, request(t, api, "POST", "/api/v1/clients", "test-operator", map[string]any{"name": "Bob", "projects": []string{"team"}}, "", 201))
	input := store.WorkerEnrollmentRequest{DeviceID: "device", RequestID: "request-1", Name: "Alice laptop", Projects: []string{"team"}, Capabilities: []store.WorkerCapability{{ProjectID: "team", WorkspaceKey: "repo", AgentID: "fixture"}}, EnrollmentSecret: strings.Repeat("ab", 32)}
	type receipt struct {
		Worker store.Worker `json:"worker"`
		Token  string       `json:"token"`
	}
	created := parse[receipt](t, request(t, api, "POST", "/api/client/v1/workers", alice.Token, input, "", 200))
	recovered := parse[receipt](t, request(t, api, "POST", "/api/client/v1/workers", alice.Token, input, "", 200))
	if created.Worker.ID != recovered.Worker.ID || created.Token != recovered.Token {
		t.Fatal("enrollment replay duplicated device/credential")
	}
	request(t, api, "POST", "/api/client/v1/workers/"+created.Worker.ID+"/disable", bob.Token, map[string]any{}, "", 404)
	invalid := input
	invalid.Capabilities = nil
	request(t, api, "POST", "/api/client/v1/workers", alice.Token, invalid, "", 400)
	foreign := input
	foreign.Projects = []string{"private"}
	foreign.Capabilities = []store.WorkerCapability{{ProjectID: "private", WorkspaceKey: "repo", AgentID: "fixture"}}
	request(t, api, "POST", "/api/client/v1/workers", alice.Token, foreign, "", 403)
	request(t, api, "POST", "/api/worker/v1/claims", alice.Token, map[string]any{"request_id": "claim", "instance_id": "instance"}, "", 401)
	trial := "/api/client/v1/projects/team/trial-submissions/placement"
	incompatible := store.TrialInput{WorkerID: created.Worker.ID, Task: store.Spec{
		Title: "Placement", Prompt: "Run fixture", Acceptance: "Observed", ProjectID: "team", WorkspaceKey: "repo", AgentID: "unsupported",
	}}
	request(t, api, "PUT", trial, alice.Token, incompatible, "", 409)
	request(t, api, "GET", trial, alice.Token, nil, "", 404)
	compatible := incompatible
	compatible.Task.AgentID = "fixture"
	accepted := parse[store.TrialReceipt](t, request(t, api, "PUT", trial, alice.Token, compatible, "", 200))
	if accepted.Run == nil {
		t.Fatalf("compatible offline Worker could not be queued: %+v", accepted)
	}
	request(t, api, "POST", trial+"/cancel", alice.Token, struct{}{}, "", 200)
	request(t, api, "POST", "/api/client/v1/workers/"+created.Worker.ID+"/disable", alice.Token, map[string]any{}, "", 200)
	request(t, api, "PUT", trial+"-disabled", alice.Token, compatible, "", 409)
	if retried := parse[store.TrialReceipt](t, request(t, api, "PUT", trial, alice.Token, compatible, "", 200)); retried.Run == nil || *retried.Run != *accepted.Run {
		t.Fatalf("Worker changes hid an existing dispatch receipt: %+v", retried)
	}
	request(t, api, "POST", "/api/worker/v1/claims", created.Token, map[string]any{"request_id": "claim", "instance_id": "instance"}, "", 401)
	input.RequestID = "operator-enroll"
	request(t, api, "POST", "/api/v1/workers/enroll", "test-operator", input, "", 200)
}

func TestAgentWorkerReconciliationReleasesOnlyTheOriginalFence(t *testing.T) {
	api := testAPI(t)
	client := func(project string) string {
		return parse[struct{ Token string }](t, request(t, api, "POST", "/api/v1/clients", "test-operator", map[string]any{"name": project, "projects": []string{project}}, "", 201)).Token
	}
	owner, outsider := client("team"), client("private")
	type enrolled struct {
		Worker store.Worker
		Token  string
	}
	enroll := func(identity, secret string) enrolled {
		return parse[enrolled](t, request(t, api, "POST", "/api/client/v1/workers", owner, store.WorkerEnrollmentRequest{
			DeviceID: identity, RequestID: "enroll", Name: identity, Projects: []string{"team"},
			Capabilities: []store.WorkerCapability{{ProjectID: "team", WorkspaceKey: "repo", AgentID: "fixture"}}, EnrollmentSecret: strings.Repeat(secret, 32),
		}, "", 200))
	}
	device, successor := enroll("original-device", "ab"), enroll("successor-device", "cd")
	input := store.TrialInput{WorkerID: device.Worker.ID, Task: store.Spec{
		Title: "Recovery", Prompt: "Run fixture", Acceptance: "Observed", ProjectID: "team", WorkspaceKey: "repo", AgentID: "fixture",
	}}
	trial := "/api/client/v1/projects/team/trial-submissions/agent-recovery"
	original := parse[store.TrialReceipt](t, request(t, api, "PUT", trial, owner, input, "", 200))
	if original.Run == nil {
		t.Fatal("missing original Run")
	}
	ref := *original.Run
	claim := func(token, key, instance string) *store.Run {
		return parse[struct{ Run *store.Run }](t, request(t, api, "POST", "/api/worker/v1/claims", token, map[string]string{"request_id": key, "instance_id": instance}, "", 200)).Run
	}
	if run := claim(device.Token, "original-claim", "old-instance"); run == nil || run.Ref() != ref {
		t.Fatalf("original execution was not claimed: %+v", run)
	}
	operatorPath := fmt.Sprintf("/api/v1/tasks/%s/runs/%s/reconciliation?generation=%d", ref.TaskID, ref.RunID, ref.Generation)
	clientPath := "/api/client/" + strings.TrimPrefix(operatorPath, "/api/")
	disablePath := "/api/client/v1/workers/" + device.Worker.ID + "/disable"
	completePath := "/api/worker/v1/runs/" + ref.RunID + "/complete"
	decision := store.RunReconciliationDecision{Disposition: store.RunConfirmedStopped, Evidence: "retained journal run_1 and device process inspection"}
	request(t, api, "PUT", operatorPath, "test-operator", decision, "", 409)
	request(t, api, "POST", completePath, device.Token, map[string]any{"generation": ref.Generation, "instance_id": "old-instance", "outcome": "reconcile", "summary": "Execution result was lost"}, "", 200)
	request(t, api, "PUT", operatorPath, owner, decision, "", 401)
	request(t, api, "GET", clientPath, outsider, nil, "", 404)
	request(t, api, "PUT", operatorPath, "test-operator", store.RunReconciliationDecision{Disposition: "unknown", Evidence: "host unreachable"}, "", 400)
	request(t, api, "POST", disablePath, owner, struct{}{}, "", 409)
	dispatchPath := "/api/client/v1/tasks/" + ref.TaskID + "/dispatch"
	destination := map[string]string{"worker_id": successor.Worker.ID}
	request(t, api, "POST", dispatchPath, owner, destination, "explicit-next-generation", 409)
	if run := claim(successor.Token, "no-automatic-takeover", "successor-instance"); run != nil {
		t.Fatalf("unresolved execution was automatically assigned to the successor: %+v", run)
	}
	if run := claim(device.Token, "quarantined", "next-instance"); run != nil {
		t.Fatalf("unresolved Run released the Worker: %+v", run)
	}
	read := func() *store.RunReconciliation {
		return parse[struct{ Reconciliation *store.RunReconciliation }](t, request(t, api, "GET", clientPath, owner, nil, "", 200)).Reconciliation
	}
	if read() != nil {
		t.Fatal("operator evidence was recorded before submission")
	}
	recorded := parse[store.RunReconciliation](t, request(t, api, "PUT", operatorPath, "test-operator", decision, "", 200))
	if got := read(); got == nil || got.Run != ref || got.RunReconciliationDecision != decision || !got.RecordedAt.Equal(recorded.RecordedAt) {
		t.Fatalf("wrong reconciliation receipt: %+v", got)
	}
	if run := claim(device.Token, "after-review", "next-instance"); run != nil {
		t.Fatalf("reconciliation implicitly requeued an execution: %+v", run)
	}
	if run := claim(device.Token, "original-claim", "old-instance"); run == nil || run.Ref() != ref || run.Status != "reconcile" || run.Summary != "Execution result was lost" {
		t.Fatalf("historical Run was rewritten: %+v", run)
	}
	next := parse[store.Run](t, request(t, api, "POST", dispatchPath, owner, destination, "explicit-next-generation", 200))
	if run := claim(successor.Token, "new-generation", "successor-instance"); run == nil || run.ID != next.ID || run.ID == ref.RunID || run.TaskID != ref.TaskID || run.Generation != ref.Generation+1 || run.WorkerID != successor.Worker.ID {
		t.Fatalf("Successor did not claim the new generation: %+v", run)
	}
	nextReplay := parse[store.Run](t, request(t, api, "POST", dispatchPath, owner, destination, "explicit-next-generation", 200))
	if nextReplay.Ref() != next.Ref() {
		t.Fatalf("retrying dispatch forked the next generation: %+v", nextReplay)
	}
	replay := parse[store.RunReconciliation](t, request(t, api, "PUT", operatorPath, "test-operator", decision, "", 200))
	if replay.Run != ref || !replay.RecordedAt.Equal(recorded.RecordedAt) {
		t.Fatalf("reconciliation replay changed evidence: %+v", replay)
	}
	request(t, api, "PUT", operatorPath, "test-operator", store.RunReconciliationDecision{Disposition: store.RunConfirmedNotStarted, Evidence: "different evidence"}, "", 409)
	request(t, api, "POST", completePath, device.Token, map[string]any{"generation": ref.Generation, "instance_id": "old-instance", "outcome": "succeeded"}, "", 409)
	request(t, api, "POST", "/api/worker/v1/runs/"+ref.RunID+"/renew", device.Token, map[string]any{"generation": ref.Generation, "instance_id": "old-instance"}, "", 409)
	request(t, api, "POST", "/api/worker/v1/runs/"+next.ID+"/complete", successor.Token, map[string]any{"generation": next.Generation, "instance_id": "successor-instance", "outcome": "succeeded"}, "", 200)
	if saved := read(); saved == nil || saved.Run != ref || !saved.RecordedAt.Equal(recorded.RecordedAt) {
		t.Fatalf("completing the new generation replaced the original receipt: %+v", saved)
	}
	request(t, api, "POST", disablePath, owner, struct{}{}, "", 200)
}
