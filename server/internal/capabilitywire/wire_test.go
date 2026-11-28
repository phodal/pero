package capabilitywire

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "../../.."))
}

func TestSharedFixtures(t *testing.T) {
	root := repoRoot(t)
	inventory, err := os.ReadFile(filepath.Join(root, "protocol/inventory/capabilities.json"))
	if err != nil {
		t.Fatal(err)
	}
	var header struct {
		Families []struct {
			ID string `json:"id"`
		} `json:"families"`
		SciencePath struct {
			Operations []string `json:"operations"`
		} `json:"sciencePath"`
		Drift []struct {
			ID string `json:"id"`
		} `json:"drift"`
	}
	if err := json.Unmarshal(inventory, &header); err != nil {
		t.Fatal(err)
	}
	got := make([]string, len(header.Families))
	for i, family := range header.Families {
		got[i] = family.ID
	}
	want := []string{"agent", "insights", "connectors", "automation", "research-assets", "skills"}
	if len(got) != len(want) {
		t.Fatalf("families %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("families %v", got)
		}
	}
	if len(header.SciencePath.Operations) != 2 || header.SciencePath.Operations[0] != "science" || header.SciencePath.Operations[1] != "science_sessions" {
		t.Fatalf("science path %v", header.SciencePath.Operations)
	}
	seen := map[string]bool{}
	for _, item := range header.Drift {
		seen[item.ID] = true
	}
	if !seen["research-assets-operations"] || !seen["agent-scope-project-id"] {
		t.Fatal("drift")
	}
	known, err := KnownOperations(inventory)
	if err != nil {
		t.Fatal(err)
	}
	fixture := filepath.Join(root, "protocol/fixtures/capability-wire")
	raw, err := os.ReadFile(filepath.Join(fixture, "cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases struct {
		Wires []struct {
			ID       string          `json:"id"`
			Schema   string          `json:"schema"`
			File     string          `json:"file"`
			Document json.RawMessage `json:"document"`
			Parse    string          `json:"parse"`
		} `json:"wires"`
		Negotiations []struct {
			ID       string          `json:"id"`
			File     string          `json:"file"`
			Document json.RawMessage `json:"document"`
			Result   string          `json:"result"`
			Grant    *bool           `json:"grant"`
		} `json:"negotiations"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, item := range cases.Wires {
		body := item.Document
		if item.File != "" {
			body, err = os.ReadFile(filepath.Join(fixture, item.File))
			if err != nil {
				t.Fatal(err)
			}
		}
		err := Parse(item.Schema, body)
		if (err == nil) != (item.Parse == "accept") {
			t.Fatalf("%s parse=%s err=%v", item.ID, item.Parse, err)
		}
	}
	for _, item := range cases.Negotiations {
		body := item.Document
		if item.File != "" {
			body, err = os.ReadFile(filepath.Join(fixture, item.File))
			if err != nil {
				t.Fatal(err)
			}
		}
		if got := Admit(body, known); string(got) != item.Result {
			t.Fatalf("%s got %s", item.ID, got)
		} else if got == Accepted {
			if item.Grant == nil || *item.Grant {
				t.Fatalf("%s grant", item.ID)
			}
			if err := Parse("CapabilityNegotiation", body); err != nil {
				t.Fatal(err)
			}
			if err := Parse("CapabilityAdmission", []byte(`{"outcome":"accepted","grant":false}`)); err != nil {
				t.Fatal(err)
			}
		}
	}
}
