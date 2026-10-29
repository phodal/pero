package runtimeauth

import (
	"context"
	"encoding/json"
	"github.com/phodal/pero/server/internal/runtimechannel"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOnlinePodIdentity(t *testing.T) {
	for _, tc := range []struct {
		name   string
		modify func(map[string]any)
		want   bool
	}{
		{"bound audience", func(map[string]any) {}, true},
		{"unauthenticated", func(s map[string]any) { s["authenticated"] = false }, false},
		{"wrong audience", func(s map[string]any) { s["audiences"] = []string{"kubernetes"} }, false},
		{"no audience", func(s map[string]any) { delete(s, "audiences") }, false},
		{"unbound token", func(s map[string]any) { s["user"].(map[string]any)["extra"] = map[string]any{} }, false},
		{"ambiguous Pod UID", func(s map[string]any) {
			s["user"].(map[string]any)["extra"] = map[string]any{"authentication.kubernetes.io/pod-uid": []string{"pod1", "pod2"}}
		}, false},
		{"not a serviceaccount", func(s map[string]any) { s["user"].(map[string]any)["username"] = "user:agent" }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status := map[string]any{"authenticated": true, "audiences": []string{runtimechannel.Audience}, "user": map[string]any{"username": "system:serviceaccount:p1:agent", "uid": "sa1", "extra": map[string]any{"authentication.kubernetes.io/pod-uid": []string{"pod1"}}}}
			tc.modify(status)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.URL.Path != "/apis/authentication.k8s.io/v1/tokenreviews" {
					t.Error("route")
				}
				var input struct {
					Spec struct {
						Token     string   `json:"token"`
						Audiences []string `json:"audiences"`
					} `json:"spec"`
				}
				if json.NewDecoder(r.Body).Decode(&input) != nil || input.Spec.Token != "opaque-bound-token" || len(input.Spec.Audiences) != 1 || input.Spec.Audiences[0] != runtimechannel.Audience {
					t.Error("input")
				}
				json.NewEncoder(w).Encode(map[string]any{"status": status})
			}))
			defer server.Close()
			reviewer, e := New(server.URL, server.Client())
			if e != nil {
				t.Fatal(e)
			}
			identity, e := reviewer.Review(context.Background(), "opaque-bound-token", runtimechannel.Audience)
			if (e == nil) != tc.want {
				t.Fatal(identity, e)
			}
			if tc.want && identity.PodUID != "pod1" {
				t.Fatal(identity)
			}
		})
	}
}
