// Package runtimeauth adapts online Kubernetes TokenReview to a narrow,
// non-secret Pod identity. Authentication never grants a Run by itself.
package runtimeauth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/phodal/pero/server/internal/runtimechannel"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Reviewer struct {
	base   string
	client *http.Client
}

func New(base string, client *http.Client) (*Reviewer, error) {
	u, e := url.Parse(base)
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" && u.Path != "/" || client == nil {
		return nil, runtimechannel.ErrAuthority
	}
	ip := net.ParseIP(u.Hostname())
	if u.Scheme != "https" && (u.Scheme != "http" || ip == nil || !ip.IsLoopback()) {
		return nil, runtimechannel.ErrAuthority
	}
	copy := *client
	copy.Timeout = 4 * time.Second
	copy.CheckRedirect = func(*http.Request, []*http.Request) error { return fmt.Errorf("TokenReview redirect rejected") }
	return &Reviewer{strings.TrimSuffix(base, "/"), &copy}, nil
}
func (v *Reviewer) Review(ctx context.Context, token, audience string) (runtimechannel.PodIdentity, error) {
	var zero runtimechannel.PodIdentity
	if token == "" || len(token) > 16<<10 || strings.ContainsAny(token, "\r\n") || audience == "" || len(audience) > 128 {
		return zero, runtimechannel.ErrAuthority
	}
	request := struct {
		APIVersion string `json:"apiVersion"`
		Kind       string `json:"kind"`
		Spec       struct {
			Token     string   `json:"token"`
			Audiences []string `json:"audiences"`
		} `json:"spec"`
	}{APIVersion: "authentication.k8s.io/v1", Kind: "TokenReview"}
	request.Spec.Token = token
	request.Spec.Audiences = []string{audience}
	data, _ := json.Marshal(request)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, v.base+"/apis/authentication.k8s.io/v1/tokenreviews", bytes.NewReader(data))
	if err != nil {
		return zero, runtimechannel.ErrAuthority
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := v.client.Do(req)
	if err != nil {
		return zero, runtimechannel.ErrAuthority
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated && response.StatusCode != http.StatusOK {
		return zero, runtimechannel.ErrAuthority
	}
	var body struct {
		Status struct {
			Authenticated bool     `json:"authenticated"`
			Audiences     []string `json:"audiences"`
			Error         string   `json:"error"`
			User          struct {
				Username string              `json:"username"`
				UID      string              `json:"uid"`
				Extra    map[string][]string `json:"extra"`
			} `json:"user"`
		} `json:"status"`
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 64<<10))
	if decoder.Decode(&body) != nil || decoder.Decode(new(any)) != io.EOF {
		return zero, runtimechannel.ErrAuthority
	}
	status := body.Status
	parts := strings.Split(status.User.Username, ":")
	pods := status.User.Extra["authentication.kubernetes.io/pod-uid"]
	if !status.Authenticated || status.Error != "" || len(status.Audiences) != 1 || status.Audiences[0] != audience || len(parts) != 4 || parts[0] != "system" || parts[1] != "serviceaccount" || parts[2] == "" || parts[3] == "" || status.User.UID == "" || len(pods) != 1 || pods[0] == "" {
		return zero, runtimechannel.ErrAuthority
	}
	return runtimechannel.PodIdentity{Namespace: parts[2], ServiceAccount: parts[3], ServiceAccountUID: status.User.UID, PodUID: pods[0], Audience: audience}, nil
}
