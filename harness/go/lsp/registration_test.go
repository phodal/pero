package lsp

import (
	"encoding/json"
	"testing"
)

func TestDynamicCapabilitySelection(t *testing.T) {
	c := &connection{}
	for _, row := range []struct {
		params string
		valid  bool
	}{
		{`{"registrations":[{"id":"hover","method":"textDocument/hover","registerOptions":{"documentSelector":[{"language":"go","scheme":"file","pattern":"**/src/**/*.go"}]}}]}`, true},
		{`{"registrations":[{"id":"hover","method":"textDocument/hover"}]}`, false},
		{`{"registrations":[{"id":"bad","method":"workspace/executeCommand"}]}`, false},
		{`{"registrations":[{"id":"notebook","method":"textDocument/hover","registerOptions":{"documentSelector":[{"notebook":"jupyter-notebook","language":"go"}]}}]}`, false},
		{`{"registrations":[{"id":"empty","method":"textDocument/hover","registerOptions":{"documentSelector":[{}]}}]}`, false},
		{`{"registrations":[{"id":"first","method":"textDocument/references"},{"id":"bad","method":"textDocument/hover","registerOptions":{"documentSelector":[{"pattern":"["}]}}]}`, false},
	} {
		if err := c.registerCapabilities(json.RawMessage(row.params)); (err == nil) != row.valid {
			t.Fatalf("registration err=%v want valid=%t", err, row.valid)
		}
	}
	for _, row := range []struct {
		file, language string
		want           bool
	}{
		{"/workspace/src/main.go", "go", true}, {"/workspace/src/pkg/main.go", "go", true}, {"/workspace/test/main.go", "go", false}, {"/workspace/src/main.go", "python", false},
	} {
		if got := c.dynamicallySupports(Hover, row.file, row.language); got != row.want {
			t.Fatalf("%s/%s=%t", row.file, row.language, got)
		}
	}
	if c.dynamicallySupports(References, "/workspace/src/main.go", "go") {
		t.Fatal("partial invalid registration was applied")
	}
	if err := c.unregisterCapabilities(json.RawMessage(`{"unregisterations":[{"id":"hover","method":"textDocument/references"}]}`)); err != nil {
		t.Fatal(err)
	}
	if !c.dynamicallySupports(Hover, "/workspace/src/main.go", "go") {
		t.Fatal("wrong method removed registration")
	}
	if err := c.unregisterCapabilities(json.RawMessage(`{"unregisterations":[{"id":"hover","method":"textDocument/hover"}]}`)); err != nil {
		t.Fatal(err)
	}
	if c.dynamicallySupports(Hover, "/workspace/src/main.go", "go") {
		t.Fatal("removed capability still enabled")
	}
}
