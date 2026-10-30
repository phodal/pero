//go:build unix

package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/runtimechannel"
	"github.com/phodal/pero/server/internal/store"
)

// Only closed vocabularies and bounded counters cross this diagnostic boundary.
// Agent/provider summaries, text, bodies, keys, paths and environment do not.
type isolatedDiagnostic struct {
	RunStatus       string                    `json:"run_status"`
	ChannelState    string                    `json:"channel_state"`
	ChargedRequests int                       `json:"charged_requests"`
	EventKinds      map[string]int            `json:"event_kinds"`
	ErrorCategories map[string]int            `json:"error_categories"`
	ControlPlane    isolatedCPSummary         `json:"control_plane"`
	Completion      isolatedCompletionMetrics `json:"completion"`
}

func isolatedFailureDiagnostic(db *store.Store, runID string) isolatedDiagnostic {
	d := isolatedDiagnostic{RunStatus: "unavailable", ChannelState: "unavailable", EventKinds: map[string]int{}, ErrorCategories: map[string]int{}}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if r, e := db.RuntimeRun(ctx, runID); e == nil {
		switch r.Status {
		case "queued", "running", "cancel_requested", "succeeded", "failed", "cancelled", "reconcile":
			d.RunStatus = r.Status
		default:
			d.RunStatus = "other"
		}
	}
	if c, e := db.RuntimeChannel(ctx, runID); e == nil {
		switch c.State {
		case runtimechannel.Reserved, runtimechannel.Attached, runtimechannel.Started, runtimechannel.Closed, runtimechannel.Lost:
			d.ChannelState = c.State
		default:
			d.ChannelState = "other"
		}
		if c.Requests >= 0 && c.Requests <= 1000 {
			d.ChargedRequests = c.Requests
		}
	}
	if events, e := db.Events(ctx, runID); e == nil {
		d.Completion = isolatedTurnEvidence(events).Metrics
		for _, event := range events.Events {
			kind := "other"
			switch event.Kind {
			case "session_ready", "session_update", "session_error", "session_closed", "session_auth_required", "session_auth_error", "turn_finished", "worker_result", "configuration_changed", "permission_denied", "permission_approved":
				kind = event.Kind
			}
			d.EventKinds[kind]++
			if kind == "session_error" || kind == "session_auth_error" {
				d.ErrorCategories[isolatedErrorCategory(event)]++
			}
		}
	}
	return d
}
func isolatedErrorCategory(event store.Event) string {
	text := strings.ToLower(event.Text + " " + string(event.Data))
	for _, category := range []struct {
		name  string
		words []string
	}{
		{"authentication", []string{"authentication", "api key", "credential"}},
		{"budget", []string{"budget", "request limit", "token limit"}},
		{"provider_or_transport", []string{"provider", "http", "upstream", "connection", "transport"}},
		{"protocol", []string{"protocol", "session/new", "unsupported"}},
		{"permission", []string{"permission"}},
	} {
		for _, word := range category.words {
			if strings.Contains(text, word) {
				return category.name
			}
		}
	}
	return "unspecified"
}

func isolatedRejectionStatus(mode string) int {
	switch mode {
	case "rejected-provider-401":
		return http.StatusUnauthorized
	case "rejected-provider-503":
		return http.StatusServiceUnavailable
	case "rejected-provider-303":
		return http.StatusSeeOther
	default:
		return 0
	}
}

func assertIsolatedEvidenceRedacted(t *testing.T, db *store.Store, runID string, credentials ...string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	events, err := db.Events(ctx, runID)
	if err != nil {
		t.Fatal("retained evidence unavailable for private-data check")
	}
	data, _ := json.Marshal(events)
	for _, marker := range append(credentials, "synthetic-pod-token", "synthetic-private-provider-body", "synthetic-private-redirect-location") {
		if marker != "" && bytes.Contains(data, []byte(marker)) {
			t.Fatal("private provider data or credential crossed into retained evidence")
		}
	}
}

// Generic Go ACP deliberately redacts provider error details. This local-only
// observer records the trusted control plane's own bounded static 502 response,
// not the external provider response. It introduces no forwarding/network hop.
// Unwrap preserves ResponseController deadlines/flush through the wrapper.
type isolatedCPSummary struct {
	ResponseStatuses map[int]int    `json:"response_statuses"`
	ProviderCodes    map[string]int `json:"provider_codes"`
	UpstreamStatuses map[int]int    `json:"upstream_statuses"`
	Unknown          int            `json:"unknown"`
}
type isolatedCPObserver struct {
	mu      sync.Mutex
	summary isolatedCPSummary
}
type isolatedCPResponse struct {
	http.ResponseWriter
	status    int
	data      []byte
	oversized bool
}

func (w *isolatedCPResponse) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *isolatedCPResponse) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *isolatedCPResponse) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(data)
	if w.status == http.StatusBadGateway && !w.oversized {
		if len(w.data)+n > 1024 {
			w.oversized = true
			w.data = nil
		} else {
			w.data = append(w.data, data[:n]...)
		}
	}
	return n, err
}
func (o *isolatedCPObserver) handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !strings.HasPrefix(r.URL.Path, "/api/runtime/v1/runs/") || !strings.HasSuffix(r.URL.Path, "/provider/v1/chat/completions") {
			next.ServeHTTP(w, r)
			return
		}
		response := &isolatedCPResponse{ResponseWriter: w}
		next.ServeHTTP(response, r)
		code, status := "unknown", 0
		if response.status == http.StatusBadGateway && !response.oversized && response.Header().Get("Content-Type") == "application/json" {
			code, status = isolatedOwnProviderResponse(response.data)
		}
		o.mu.Lock()
		defer o.mu.Unlock()
		if o.summary.ProviderCodes == nil {
			o.summary.ProviderCodes = map[string]int{}
			o.summary.ResponseStatuses = map[int]int{}
			o.summary.UpstreamStatuses = map[int]int{}
		}
		if response.status >= 100 && response.status <= 599 {
			o.summary.ResponseStatuses[response.status]++
		}
		if response.status != http.StatusBadGateway {
			return
		}
		o.summary.ProviderCodes[code]++
		if status != 0 {
			o.summary.UpstreamStatuses[status]++
		}
		if code == "unknown" {
			o.summary.Unknown++
		}
	})
}
func (o *isolatedCPObserver) snapshot() isolatedCPSummary {
	o.mu.Lock()
	defer o.mu.Unlock()
	s := isolatedCPSummary{ResponseStatuses: map[int]int{}, ProviderCodes: map[string]int{}, UpstreamStatuses: map[int]int{}, Unknown: o.summary.Unknown}
	for status, n := range o.summary.ResponseStatuses {
		s.ResponseStatuses[status] = n
	}
	for code, n := range o.summary.ProviderCodes {
		s.ProviderCodes[code] = n
	}
	for status, n := range o.summary.UpstreamStatuses {
		s.UpstreamStatuses[status] = n
	}
	return s
}
func isolatedOwnProviderResponse(data []byte) (string, int) {
	var response struct {
		Error struct {
			Message string `json:"message"`
			Code    string `json:"code"`
			Status  int    `json:"upstream_status,omitempty"`
		} `json:"error"`
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if d.Decode(&response) != nil || d.Decode(new(any)) != io.EOF {
		return "unknown", 0
	}
	e := response.Error
	switch e.Code {
	case "PERO_PROVIDER_UPSTREAM_HTTP":
		if e.Status < 100 || e.Status > 599 || e.Message != fmt.Sprintf("%s status=%d", e.Code, e.Status) {
			return "unknown", 0
		}
	case "PERO_PROVIDER_CONTENT_TYPE":
		if e.Status != 200 || e.Message != "PERO_PROVIDER_CONTENT_TYPE status=200" {
			return "unknown", 0
		}
	case "PERO_PROVIDER_TRANSPORT":
		if e.Status != 0 || e.Message != e.Code {
			return "unknown", 0
		}
	default:
		return "unknown", 0
	}
	return e.Code, e.Status
}

func TestIsolatedSafeProviderDiagnostic(t *testing.T) {
	for _, tc := range []struct {
		body, code string
		status     int
	}{
		{`{"error":{"message":"PERO_PROVIDER_UPSTREAM_HTTP status=401","code":"PERO_PROVIDER_UPSTREAM_HTTP","upstream_status":401}}`, "PERO_PROVIDER_UPSTREAM_HTTP", 401},
		{`{"error":{"message":"PERO_PROVIDER_CONTENT_TYPE status=200","code":"PERO_PROVIDER_CONTENT_TYPE","upstream_status":200}}`, "PERO_PROVIDER_CONTENT_TYPE", 200},
		{`{"error":{"message":"PERO_PROVIDER_TRANSPORT","code":"PERO_PROVIDER_TRANSPORT"}}`, "PERO_PROVIDER_TRANSPORT", 0},
		{`{"error":{"message":"private provider body","code":"PERO_PROVIDER_UPSTREAM_HTTP","upstream_status":401}}`, "unknown", 0},
		{`{"error":{"message":"PERO_PROVIDER_UPSTREAM_HTTP status=600","code":"PERO_PROVIDER_UPSTREAM_HTTP","upstream_status":600}}`, "unknown", 0},
		{`{"error":{"message":"PERO_PROVIDER_UPSTREAM_HTTP status=401","code":"PERO_PROVIDER_UPSTREAM_HTTP","upstream_status":401,"private":"extra"}}`, "unknown", 0},
		{`{"error":{"message":"PERO_PROVIDER_CONTENT_TYPE status=401","code":"PERO_PROVIDER_CONTENT_TYPE","upstream_status":401}}`, "unknown", 0},
		{`{"error":{"message":"PERO_PROVIDER_TRANSPORT","code":"PERO_PROVIDER_TRANSPORT"}} {}`, "unknown", 0},
	} {
		code, status := isolatedOwnProviderResponse([]byte(tc.body))
		if code != tc.code || status != tc.status {
			t.Fatalf("safe diagnostic projection got %s/%d, wanted %s/%d", code, status, tc.code, tc.status)
		}
	}
}

// Reconstruct only the first retained session's first turn. These fixtures send
// one prompt per Run; missing/truncated boundaries cannot prove the answer.
// ACP updates omit sessionId today, so the durable session/turn event boundaries
// provide scope; if a future update includes an ID, it must match as well.
type isolatedCompletionMetrics struct {
	Scope                  string         `json:"scope"`
	Complete               bool           `json:"complete"`
	TextDeltas             int            `json:"text_deltas"`
	TextBytes              int            `json:"text_bytes"`
	ReasoningDeltas        int            `json:"reasoning_deltas"`
	ReasoningBytes         int            `json:"reasoning_bytes"`
	ACPStopReasons         map[string]int `json:"acp_stop_reasons"`
	ProviderUsageEvidence  string         `json:"provider_usage_evidence"`
	ProviderFinishEvidence string         `json:"provider_finish_reason_evidence"`
}
type isolatedRetainedTurn struct {
	Text    string
	Metrics isolatedCompletionMetrics
}

func isolatedTurnEvidence(tail *store.EventTail) isolatedRetainedTurn {
	result := isolatedRetainedTurn{Metrics: isolatedCompletionMetrics{Scope: "missing", ACPStopReasons: map[string]int{}, ProviderUsageEvidence: "not_retained", ProviderFinishEvidence: "not_retained"}}
	if tail == nil {
		return result
	}
	if tail.Truncated {
		result.Metrics.Scope = "truncated"
		return result
	}
	session, active, lastSeq := "", false, int64(0)
	var answer strings.Builder
	for _, event := range tail.Events {
		if event.Seq <= lastSeq {
			result.Metrics.Scope = "invalid"
			return result
		}
		lastSeq = event.Seq
		switch event.Kind {
		case "session_ready":
			var ready struct {
				SessionID string `json:"sessionId"`
			}
			if session != "" || active || json.Unmarshal(event.Data, &ready) != nil || ready.SessionID == "" {
				result.Metrics.Scope = "invalid"
				return result
			}
			session = ready.SessionID
		case "turn_started":
			if session == "" || active {
				result.Metrics.Scope = "invalid"
				return result
			}
			active = true
			result.Metrics.Scope = "bound"
		case "session_update":
			if !active {
				continue
			}
			var update struct {
				SessionID string `json:"sessionId"`
				Kind      string `json:"sessionUpdate"`
				Content   struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"content"`
			}
			if json.Unmarshal(event.Data, &update) != nil {
				continue
			}
			if update.SessionID != "" && update.SessionID != session {
				result.Metrics.Scope = "invalid"
				return result
			}
			if update.Content.Type != "text" || update.Content.Text == "" {
				continue
			}
			size := len(update.Content.Text)
			if result.Metrics.TextBytes+result.Metrics.ReasoningBytes+size > 256*1024 {
				result.Metrics.Scope = "invalid"
				return result
			}
			switch update.Kind {
			case "agent_message_chunk":
				result.Metrics.TextDeltas++
				result.Metrics.TextBytes += size
				answer.WriteString(update.Content.Text)
			case "agent_thought_chunk":
				result.Metrics.ReasoningDeltas++
				result.Metrics.ReasoningBytes += size
			}
		case "turn_finished":
			if !active {
				continue
			}
			var finished struct {
				StopReason string `json:"stopReason"`
			}
			_ = json.Unmarshal(event.Data, &finished)
			reason := "other"
			switch finished.StopReason {
			case "end_turn", "cancelled", "max_tokens", "max_turn_requests", "refusal":
				reason = finished.StopReason
			}
			result.Metrics.ACPStopReasons[reason]++
			result.Metrics.Complete = true
			result.Text = answer.String()
			return result
		case "session_closed":
			// Cancellation can close without a turn_finished response. Preserve
			// already scoped deltas, but never claim a completed answer.
			if active {
				result.Text = answer.String()
			} else {
				result.Metrics.Scope = "invalid"
			}
			return result
		}
	}
	result.Text = answer.String()
	return result
}
func isolatedAnswerMatches(events *store.EventTail) bool {
	turn := isolatedTurnEvidence(events)
	return turn.Metrics.Scope == "bound" && turn.Metrics.Complete && strings.TrimSpace(turn.Text) == "PERO_LIVE_OK"
}
func TestIsolatedAnswerEvidence(t *testing.T) {
	event := func(kind, data string) store.Event { return store.Event{Kind: kind, Data: json.RawMessage(data)} }
	ready := event("session_ready", `{"sessionId":"session-1"}`)
	start := event("turn_started", `null`)
	finish := event("turn_finished", `{"stopReason":"end_turn"}`)
	text := func(value string) store.Event {
		data, _ := json.Marshal(map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{"type": "text", "text": value}})
		return store.Event{Kind: "session_update", Data: data}
	}
	thought := event("session_update", `{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"PERO_LIVE_OK"}}`)
	for _, tc := range []struct {
		name   string
		events []store.Event
		want   bool
	}{
		{"split-marker", []store.Event{ready, start, text("PERO_"), text("LIVE_OK"), finish}, true},
		{"whitespace-only-surround", []store.Event{ready, start, text(" PERO_LIVE_OK\n"), finish}, true},
		{"prefixed-answer", []store.Event{ready, start, text("unrelated PERO_LIVE_OK"), finish}, false},
		{"suffixed-answer", []store.Event{ready, start, text("PERO_LIVE_OK unrelated"), finish}, false},
		{"reasoning-is-not-answer", []store.Event{ready, start, thought, finish}, false},
		{"tool-is-not-answer", []store.Event{ready, start, event("session_update", `{"sessionUpdate":"tool_call_update","content":{"type":"text","text":"PERO_LIVE_OK"}}`), finish}, false},
		{"later-turn-is-not-answer", []store.Event{ready, start, text("no marker"), finish, start, text("PERO_LIVE_OK"), finish}, false},
		{"earlier-text-is-not-answer", []store.Event{text("PERO_LIVE_OK"), ready, start, finish}, false},
		{"empty-finish", []store.Event{ready, start, finish}, false},
		{"incomplete-cancel", []store.Event{ready, start, text("PERO_LIVE_OK"), event("session_closed", `null`)}, false},
		{"other-session", []store.Event{ready, start, event("session_ready", `{"sessionId":"session-2"}`), text("PERO_LIVE_OK"), finish}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for i := range tc.events {
				tc.events[i].Seq = int64(i + 1)
			}
			if got := isolatedAnswerMatches(&store.EventTail{Events: tc.events}); got != tc.want {
				t.Fatalf("scoped answer marker got=%t want=%t", got, tc.want)
			}
		})
	}

	events := []store.Event{ready, start, text("PERO_"), thought, text("LIVE_OK"), finish}
	for i := range events {
		events[i].Seq = int64(i + 1)
	}
	tail := &store.EventTail{Events: events}
	metrics := isolatedTurnEvidence(tail).Metrics
	if metrics.TextDeltas != 2 || metrics.TextBytes != 12 || metrics.ReasoningDeltas != 1 || metrics.ReasoningBytes != 12 || metrics.ACPStopReasons["end_turn"] != 1 || metrics.ProviderUsageEvidence != "not_retained" {
		t.Fatal("bounded completion metrics differ from retained evidence")
	}
	encoded, _ := json.Marshal(metrics)
	if bytes.Contains(encoded, []byte("PERO_LIVE_OK")) {
		t.Fatal("text leaked into completion diagnostics")
	}
	tail.Truncated = true
	if isolatedAnswerMatches(tail) {
		t.Fatal("truncated tail proved an answer")
	}
	tail.Truncated = false
	tail.Events[2].Seq = tail.Events[1].Seq
	if isolatedAnswerMatches(tail) {
		t.Fatal("unordered tail proved an answer")
	}
}
