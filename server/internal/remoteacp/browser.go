package remoteacp

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"time"
)

// The Pod shim fixes the destination and uses the projected identity for each
// call. The ACP process only receives the existing loopback endpoint.
func proxyBrowser(c AgentConfig, client *http.Client, w http.ResponseWriter, r *http.Request) {
	const requestLimit = 16 << 10
	const replyLimit = 256 << 10
	if r.URL.RawQuery != "" || r.Header.Get("Content-Type") != "application/json" {
		http.Error(w, "invalid Browser Use request", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 28*time.Second)
	defer cancel()
	if err := http.NewResponseController(w).SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		http.Error(w, "Browser Use transport unavailable", http.StatusServiceUnavailable)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, requestLimit))
	if err != nil {
		http.Error(w, "invalid or oversized Browser Use request", http.StatusBadRequest)
		return
	}
	token, err := tokenFile(c.TokenFile)
	if err != nil {
		http.Error(w, "runtime identity unavailable", http.StatusServiceUnavailable)
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Channel.endpoint("/browser/call"), bytes.NewReader(body))
	if err != nil {
		http.Error(w, "invalid Browser Use endpoint", http.StatusBadRequest)
		return
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	response, err := client.Do(req)
	if err != nil {
		http.Error(w, "Browser Use result unavailable. Verify the page before retrying.", http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	result, err := io.ReadAll(io.LimitReader(response.Body, replyLimit+1))
	if err != nil || len(result) > replyLimit {
		http.Error(w, "Browser Use result unavailable. Verify the page before retrying.", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", response.Header.Get("Content-Type"))
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(result)
}
