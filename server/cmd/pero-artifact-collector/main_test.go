package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
)

func TestCollectorRegistrationAndBoundedControlTransport(t *testing.T) {
	for _, test := range []struct {
		name      string
		status    int
		huge      bool
		wantError bool
	}{{"pending registration", 425, false, false}, {"denied identity", 403, false, true}, {"oversize plan", 200, true, true}} {
		t.Run(test.name, func(t *testing.T) {
			token := filepath.Join(t.TempDir(), "projected-token")
			if err := os.WriteFile(token, []byte("original-token"), 0600); err != nil {
				t.Fatal(err)
			}
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				expected := "original-token"
				if calls > 1 {
					expected = "rotated-token"
				}
				if r.Header.Get("Authorization") != "Bearer "+expected || r.URL.Path != "/api/artifact-export/v1/export" {
					t.Error("projected identity or original export changed")
				}
				if calls == 1 && test.status != 200 {
					os.WriteFile(token, []byte("rotated-token"), 0600)
					w.WriteHeader(test.status)
					return
				}
				if test.huge {
					w.Write([]byte(strings.Repeat(" ", artifacts.MaxManifestBytes+1)))
					return
				}
				json.NewEncoder(w).Encode(artifacts.Export{ID: "export", Phase: artifacts.Committed})
			}))
			defer server.Close()
			c := &controlClient{origin: server.URL, id: "export", tokenFile: token, client: server.Client()}
			ctx, cancel := context.WithTimeout(t.Context(), time.Second)
			defer cancel()
			var e artifacts.Export
			err := c.plan(ctx, &e)
			if (err != nil) != test.wantError {
				t.Fatalf("plan=%+v err=%v", e, err)
			}
			if test.status == 403 && calls != 1 {
				t.Fatal("denied identity retried")
			}
			if !test.wantError && e.ID != "export" {
				t.Fatal("original plan not recovered")
			}
		})
	}
}
