package main

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestHTTPAttemptAuditRequiresExistingFileAndAppends(t *testing.T) {
	if hook, err := httpAttemptAudit("", 0); err != nil || hook != nil {
		t.Fatal("audit must be default-off")
	}
	if _, err := httpAttemptAudit("relative", 1); err == nil {
		t.Fatal("relative audit accepted")
	}
	path := filepath.Join(t.TempDir(), "attempts")
	hook, err := httpAttemptAudit(path, 4)
	if err != nil {
		t.Fatal(err)
	}
	if err = hook(); err == nil {
		t.Fatal("missing file accepted")
	}
	if err = os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if err = hook(); err != nil {
		t.Fatal(err)
	}
	if err = hook(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "attempt\nattempt\n" {
		t.Fatalf("audit=%q error=%v", data, err)
	}
	if err = os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err = hook(); err == nil {
		t.Fatal("removed file accepted")
	}
}

func TestHTTPAttemptAuditConcurrentAndCapped(t *testing.T) {
	for _, limit := range []int{0, 20} {
		t.Run(map[bool]string{true: "uncapped", false: "capped"}[limit == 0], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "attempts")
			if err := os.WriteFile(path, nil, 0600); err != nil {
				t.Fatal(err)
			}
			hook, err := httpAttemptAudit(path, limit)
			if err != nil {
				t.Fatal(err)
			}
			var group sync.WaitGroup
			results := make(chan error, 40)
			for i := 0; i < 40; i++ {
				group.Add(1)
				go func() { defer group.Done(); results <- hook() }()
			}
			group.Wait()
			close(results)
			succeeded := 0
			for err := range results {
				if err == nil {
					succeeded++
				}
			}
			data, err := os.ReadFile(path)
			want := 40
			if limit > 0 {
				want = limit
			}
			if err != nil || succeeded != want || string(data) != strings.Repeat("attempt\n", want) {
				t.Fatalf("success=%d audit=%q error=%v", succeeded, data, err)
			}
		})
	}
}
