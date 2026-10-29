package runtimegateway

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/phodal/pero/server/internal/runtimechannel"
)

// ProviderConfig is operator-owned. Endpoint is the exact chat-completions
// route, not a client-supplied base URL. No request header is forwarded.
type ProviderConfig struct {
	Endpoint, Model, APIKey string
	Budget                  runtimechannel.ProviderBudget
}

func (c ProviderConfig) Validate() error {
	u, e := url.Parse(c.Endpoint)
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !strings.HasSuffix(u.Path, "/chat/completions") || c.Model == "" || len(c.Model) > 128 || c.APIKey == "" || strings.ContainsAny(c.APIKey, "\r\n") || c.Budget.Validate() != nil {
		return runtimechannel.ErrAuthority
	}
	ip := net.ParseIP(u.Hostname())
	if u.Scheme != "https" && (u.Scheme != "http" || ip == nil || !ip.IsLoopback()) {
		return runtimechannel.ErrAuthority
	}
	return nil
}
func (c ProviderConfig) client() *http.Client {
	return &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}, ResponseHeaderTimeout: 15 * time.Second}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

// ValidateProviderBody deliberately supports only text chat and function-tool
// descriptions. Provider-hosted tools, URLs, file IDs, alternate routes/models,
// metadata and arbitrary vendor extensions are not this profile's authority.
func ValidateProviderBody(data []byte, model string, maxTokens int) ([]byte, error) {
	var body map[string]json.RawMessage
	if json.Unmarshal(data, &body) != nil || body == nil {
		return nil, runtimechannel.ErrAuthority
	}
	allowed := map[string]bool{"model": true, "messages": true, "tools": true, "max_tokens": true, "stream": true, "stream_options": true, "temperature": true, "stop": true, "reasoning_effort": true, "thinking": true}
	for k := range body {
		if !allowed[k] {
			return nil, runtimechannel.ErrAuthority
		}
	}
	if raw, ok := body["stream"]; ok {
		var v bool
		if json.Unmarshal(raw, &v) != nil {
			return nil, runtimechannel.ErrAuthority
		}
	}
	if raw, ok := body["stream_options"]; ok {
		var v struct {
			IncludeUsage bool `json:"include_usage"`
		}
		if strict(raw, &v) != nil {
			return nil, runtimechannel.ErrAuthority
		}
	}
	if raw, ok := body["thinking"]; ok {
		var v struct {
			Type string `json:"type"`
		}
		if strict(raw, &v) != nil || v.Type != "disabled" {
			return nil, runtimechannel.ErrAuthority
		}
	}
	if raw, ok := body["reasoning_effort"]; ok {
		var v string
		if json.Unmarshal(raw, &v) != nil || v != "none" && v != "minimal" && v != "low" && v != "medium" && v != "high" {
			return nil, runtimechannel.ErrAuthority
		}
	}
	if raw, ok := body["temperature"]; ok {
		var v float64
		if json.Unmarshal(raw, &v) != nil || v < 0 || v > 2 {
			return nil, runtimechannel.ErrAuthority
		}
	}
	if raw, ok := body["stop"]; ok {
		var v []string
		if json.Unmarshal(raw, &v) != nil || len(v) > 8 {
			return nil, runtimechannel.ErrAuthority
		}
		for _, stop := range v {
			if len(stop) > 128 {
				return nil, runtimechannel.ErrAuthority
			}
		}
	}
	var requested string
	if json.Unmarshal(body["model"], &requested) != nil || requested != model {
		return nil, runtimechannel.ErrAuthority
	}
	var messages []map[string]json.RawMessage
	if json.Unmarshal(body["messages"], &messages) != nil || len(messages) == 0 || len(messages) > 4096 {
		return nil, runtimechannel.ErrAuthority
	}
	for _, m := range messages {
		for k, v := range m {
			switch k {
			case "role", "reasoning_content", "tool_call_id":
				var s string
				if json.Unmarshal(v, &s) != nil {
					return nil, runtimechannel.ErrAuthority
				}
			case "content":
				var s string
				if string(v) != "null" && json.Unmarshal(v, &s) != nil {
					return nil, runtimechannel.ErrAuthority
				}
			case "tool_calls":
				var calls []json.RawMessage
				if json.Unmarshal(v, &calls) != nil {
					return nil, runtimechannel.ErrAuthority
				}
			default:
				return nil, runtimechannel.ErrAuthority
			}
		}
	}
	if raw, ok := body["tools"]; ok {
		var tools []struct {
			Type     string          `json:"type"`
			Function json.RawMessage `json:"function"`
		}
		d := json.NewDecoder(bytes.NewReader(raw))
		d.DisallowUnknownFields()
		if d.Decode(&tools) != nil {
			return nil, runtimechannel.ErrAuthority
		}
		for _, tool := range tools {
			if tool.Type != "function" || len(tool.Function) == 0 {
				return nil, runtimechannel.ErrAuthority
			}
		}
	}
	tokens := maxTokens
	if raw, ok := body["max_tokens"]; ok {
		var n int
		if json.Unmarshal(raw, &n) != nil || n < 1 || n > maxTokens {
			return nil, runtimechannel.ErrAuthority
		}
		tokens = n
	}
	body["max_tokens"], _ = json.Marshal(tokens)
	return json.Marshal(body)
}
func (g *Gateway) proxy(w http.ResponseWriter, r *http.Request) {
	rc := http.NewResponseController(w)
	if rc.SetReadDeadline(time.Now().Add(5*time.Second)) != nil || rc.SetWriteDeadline(time.Now().Add(time.Duration(g.provider.Budget.TimeoutSeconds+5)*time.Second)) != nil {
		deny(w, 500)
		return
	}
	select {
	case g.ingress <- struct{}{}:
		defer func() { <-g.ingress }()
	default:
		deny(w, 429)
		return
	}
	token, ok := bearer(r)
	runID := r.PathValue("id")
	if !ok || r.URL.Query().Get("session_id") != runID || len(r.URL.Query()) != 1 {
		deny(w, 401)
		return
	}
	p := g.livePair(runID)
	if p == nil {
		deny(w, 403)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(g.provider.Budget.TimeoutSeconds)*time.Second)
	defer cancel()
	completed := make(chan struct{})
	defer close(completed)
	go func() {
		select {
		case <-completed:
			return
		case <-ctx.Done():
		case <-p.done:
			cancel()
		}
		select {
		case <-completed:
			return
		default:
		}
		_ = rc.SetReadDeadline(time.Now())
		_ = rc.SetWriteDeadline(time.Now())
	}()
	identity, err := g.reviewer.Review(ctx, token, runtimechannel.Audience)
	if err != nil {
		deny(w, 403)
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, g.provider.Budget.MaxRequestBytes))
	if err != nil {
		deny(w, 413)
		return
	}
	data, err = ValidateProviderBody(data, g.provider.Model, g.provider.Budget.MaxOutputTokens)
	if err != nil {
		deny(w, 400)
		return
	}

	_, attempt, err := g.db.ReserveRuntimeProvider(ctx, runID, identity)
	if err != nil {
		deny(w, 403)
		return
	}
	defer func() {
		finish, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		_ = g.db.FinishRuntimeProvider(finish, runID, attempt)
	}()
	// A cancellation or stale/replaced binding also interrupts an active upstream
	// response. This bounds observation latency, not instantaneous attestation.
	go func() {
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if _, e := g.db.AuthorizeRuntimeChannel(ctx, runID); e != nil {
					cancel()
					return
				}
			}
		}
	}()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.provider.Endpoint, bytes.NewReader(data))
	if err != nil {
		deny(w, 500)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+g.provider.APIKey)
	response, err := g.client.Do(req)
	if err != nil {
		deny(w, 502)
		return
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		deny(w, 502)
		return
	}
	content := response.Header.Get("Content-Type")
	if !strings.HasPrefix(content, "application/json") && !strings.HasPrefix(content, "text/event-stream") {
		deny(w, 502)
		return
	}
	w.Header().Set("Content-Type", content)
	w.WriteHeader(200)
	// The bounded stream is never retried, including a timeout after upstream use.
	reader := io.LimitReader(response.Body, g.provider.Budget.MaxResponseBytes+1)
	buffer := make([]byte, 16<<10)
	var total int64
	for {
		n, e := reader.Read(buffer)
		if n > 0 {
			total += int64(n)
			if total > g.provider.Budget.MaxResponseBytes {
				return
			}
			if _, err = w.Write(buffer[:n]); err != nil {
				return
			}
			if err = http.NewResponseController(w).Flush(); err != nil {
				return
			}
		}
		if e != nil {
			return
		}
	}
}

func strict(data []byte, target any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	return d.Decode(target)
}
