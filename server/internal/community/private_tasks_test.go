package community

import (
	"bytes"
	"context"
	"encoding/json"
	"html"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/store"
)

func TestPrivateTaskReceipts(t *testing.T) {
	f := communityHTTP(t)
	ctx := context.Background()
	base, _ := url.Parse(f.app.URL)
	draftsURL := f.app.URL + privateTasksPath
	jar, _ := cookiejar.New(nil)
	browser := &http.Client{Jar: jar, Timeout: 5 * time.Second}
	if status, _ := fetch(t, browser, "GET", draftsURL, "", nil); status != http.StatusUnauthorized {
		t.Fatalf("anonymous task drafts status: %d", status)
	}
	loginURL := f.app.URL + "/auth/github?" + url.Values{"next": {privateTasksPath}}.Encode()
	status, body := fetch(t, browser, "GET", loginURL, "", nil)
	if status != http.StatusOK || !strings.Contains(body, "当前账号没有可用的工作区") {
		t.Fatalf("unprovisioned user: %d %s", status, body)
	}
	var session *store.CommunitySession
	for _, cookie := range jar.Cookies(base) {
		if cookie.Name == "pero_community" {
			var err error
			session, err = f.db.CommunitySession(ctx, cookie.Value)
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	if session == nil {
		t.Fatal("missing GitHub session")
	}
	if err := f.db.CommunityBindWorker(ctx, f.workerID, session.Login); err != nil {
		t.Fatal(err)
	}
	client, err := f.db.CommunityClient(ctx, session)
	if err != nil {
		t.Fatal(err)
	}
	capability := store.WorkerCapability{ProjectID: "pero", WorkspaceKey: "mobile/开发", AgentID: "pero"}
	enrollment, err := (store.WorkerEnrollmentRequest{
		DeviceID: "fixture-mac", RequestID: "enroll", Name: "Fixture Mac", Projects: []string{"pero"},
		Capabilities: []store.WorkerCapability{capability}, EnrollmentSecret: random(),
	}).Authorize(client)
	if err != nil {
		t.Fatal(err)
	}
	worker, _, err := f.db.EnrollWorker(ctx, enrollment)
	if err != nil {
		t.Fatal(err)
	}
	status, body = fetch(t, browser, "GET", draftsURL, "", nil)
	match := regexp.MustCompile(`name="request_id" value="([a-f0-9]{64})"`).FindStringSubmatch(body)
	if status != http.StatusOK || len(match) != 2 || !strings.Contains(body, "mobile/开发") || !strings.Contains(body, `enctype="multipart/form-data"`) {
		t.Fatalf("task form: %d %s", status, body)
	}
	encoded, _ := json.Marshal(capability)
	form := url.Values{
		"csrf": {session.CSRF}, "request_id": {match[1]}, "workspace": {string(encoded)},
		"title": {"Only Alice's task"}, "prompt": {"<script>draft</script>"}, "acceptance": {"Check the receipt"},
	}
	if status, _ := fetch(t, browser, "POST", draftsURL, "https://another.example", form); status != http.StatusForbidden {
		t.Fatalf("cross-origin submission: %d", status)
	}
	form.Set("csrf", "wrong")
	if status, _ := fetch(t, browser, "POST", draftsURL, f.app.URL, form); status != http.StatusForbidden {
		t.Fatalf("invalid CSRF submission: %d", status)
	}
	form.Set("csrf", session.CSRF)
	form.Set("workspace", `{"project_id":"pero","workspace_key":"not-granted","agent_id":"pero"}`)
	if status, body := fetch(t, browser, "POST", draftsURL, f.app.URL, form); status != http.StatusBadRequest || !strings.Contains(body, "Check the receipt") {
		t.Fatalf("forged workspace or lost form values: %d %s", status, body)
	}
	form.Set("workspace", string(encoded))
	longPrompt := "<script>draft</script>" + strings.Repeat("数", 60_000)
	form.Set("prompt", longPrompt)
	if len(form.Encode()) <= 512*1024 {
		t.Fatal("urlencoded form fits the production proxy limit")
	}
	postDraft := func() (int, string) {
		t.Helper()
		var payload bytes.Buffer
		writer := multipart.NewWriter(&payload)
		for name, value := range form {
			if err := writer.WriteField(name, value[0]); err != nil {
				t.Fatal(err)
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		if payload.Len() > 512*1024 {
			t.Fatal("multipart form exceeds the production proxy limit")
		}
		req, _ := http.NewRequest("POST", draftsURL, &payload)
		req.Header.Set("Origin", f.app.URL)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		postBrowser := *browser
		postBrowser.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		resp, err := postBrowser.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		return resp.StatusCode, resp.Header.Get("Location")
	}
	status, taskPath := postDraft()
	if status != http.StatusSeeOther || !strings.HasPrefix(taskPath, privateTasksPath+"/task_") {
		t.Fatalf("private receipt: %d %s", status, taskPath)
	}
	if status, replay := postDraft(); status != http.StatusSeeOther || replay != taskPath {
		t.Fatalf("duplicate submission: %d %s", status, replay)
	}
	form.Set("title", "changed receipt")
	if status, _ := postDraft(); status != http.StatusConflict {
		t.Fatalf("changed submission under same receipt: %d", status)
	}
	taskID := strings.TrimPrefix(taskPath, privateTasksPath+"/")
	if status, body := fetch(t, browser, "GET", f.app.URL+taskPath, "", nil); status != http.StatusOK || !strings.Contains(body, "待 Desktop 分配") || !strings.Contains(body, html.EscapeString(longPrompt)) {
		t.Fatalf("draft detail with escaped prompt: status %d, body length %d", status, len(body))
	}
	if status, _ := fetch(t, browser, "GET", f.app.URL+"/tasks/"+taskID, "", nil); status != http.StatusNotFound {
		t.Fatalf("draft appeared in public board: %d", status)
	}

	first, err := f.db.ClientDispatch(ctx, client, taskID, worker.ID, "first")
	if err != nil {
		t.Fatal(err)
	}
	const instance = "mobile-fixture-instance"
	claimed, err := f.db.Claim(ctx, worker.ID, instance, "first-claim")
	if err != nil || claimed == nil || claimed.ID != first.ID {
		t.Fatalf("claim: %+v %v", claimed, err)
	}
	events := []store.Event{
		{Seq: 1, Kind: "session_update", Data: json.RawMessage(`{"sessionUpdate":"tool_call","title":"Check project","content":[]}`)},
		{Seq: 2, Kind: "session_update", Data: json.RawMessage(`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Agent result marker"}}`)},
	}
	if _, err = f.db.AppendEvents(ctx, first.ID, worker.ID, instance, first.Generation, events); err != nil {
		t.Fatal(err)
	}
	if _, err = f.db.Complete(ctx, first.ID, worker.ID, instance, first.Generation, store.Completion{Outcome: "succeeded", Summary: "Completed output"}); err != nil {
		t.Fatal(err)
	}
	second, err := f.db.ClientDispatch(ctx, client, taskID, worker.ID, "second")
	if err != nil {
		t.Fatal(err)
	}
	exactPath := taskPath + "/runs/" + first.ID + "?generation=" + strconv.FormatInt(first.Generation, 10)
	if status, body := fetch(t, browser, "GET", f.app.URL+exactPath, "", nil); status != http.StatusOK || !strings.Contains(body, "Agent result marker") || !strings.Contains(body, "Check project") || !strings.Contains(body, "Completed output") || strings.Contains(body, second.ID) {
		t.Fatalf("exact prior run: %d %s", status, body)
	}
	if status, _ := fetch(t, browser, "GET", f.app.URL+taskPath+"/runs/"+first.ID+"?generation="+strconv.FormatInt(second.Generation, 10), "", nil); status != http.StatusNotFound {
		t.Fatalf("wrong generation: %d", status)
	}
	if _, err = f.db.ClientCancelRun(ctx, client, second.Ref()); err != nil {
		t.Fatal(err)
	}
	if _, err = f.db.ReleaseTask(ctx, client, taskID); err != nil {
		t.Fatal(err)
	}
	if err = f.db.DisableOwnedWorker(ctx, client.ID, worker.ID); err != nil {
		t.Fatal(err)
	}
	form.Set("title", "Only Alice's task")
	if status, replay := postDraft(); status != http.StatusSeeOther || replay != taskPath {
		t.Fatalf("repeat after disabling the Worker: %d %s", status, replay)
	}
	form.Set("request_id", random())
	if status, _ := postDraft(); status != http.StatusBadRequest {
		t.Fatalf("new submission after disabling the Worker: %d", status)
	}
	if status, body := fetch(t, browser, "GET", draftsURL, "", nil); status != http.StatusOK || !strings.Contains(body, "当前账号没有可用的工作区") || !strings.Contains(body, taskID) {
		t.Fatalf("disabled device removed a receipt or remains selectable: %d %s", status, body)
	}
	if err = f.db.CommunityUpsertUser(ctx, 102, "bob"); err != nil {
		t.Fatal(err)
	}
	bobWorker, _, err := f.db.CreateWorker(ctx, "Bob's fixture Mac", []string{"pero"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = f.db.CommunityBindWorker(ctx, bobWorker.ID, "bob"); err != nil {
		t.Fatal(err)
	}
	otherJar, _ := cookiejar.New(nil)
	other := &http.Client{Jar: otherJar, Timeout: 5 * time.Second}
	otherToken := random()
	if err = f.db.CommunityCreateSession(ctx, otherToken, random(), 102, false); err != nil {
		t.Fatal(err)
	}
	otherJar.SetCookies(base, []*http.Cookie{{Name: "pero_community", Value: otherToken, Path: "/"}})
	if status, _ := fetch(t, other, "GET", f.app.URL+exactPath, "", nil); status != http.StatusNotFound {
		t.Fatalf("another account can open exact execution: %d", status)
	}
	newJar, _ := cookiejar.New(nil)
	newBrowser := &http.Client{Jar: newJar, Timeout: 5 * time.Second}
	if status, body := fetch(t, newBrowser, "GET", f.app.URL+"/auth/github?"+url.Values{"next": {exactPath}}.Encode(), "", nil); status != http.StatusOK || !strings.Contains(body, "Agent result marker") {
		t.Fatalf("exact run after signing in on another browser: %d %s", status, body)
	}
}
