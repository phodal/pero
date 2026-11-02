package lsp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestCursorCoordinatesAndResultBounds(t *testing.T) {
	for _, test := range []struct {
		line, character int
		text            string
		position        Position
		symbol          string
		valid           bool
	}{
		{2, 6, "package fixture\nfunc Greet() {}\n", Position{1, 5}, "Greet", true},
		{1, 3, "😀Greet", Position{0, 2}, "Greet", true},
		{1, 2, "😀Greet", Position{}, "", false},
		{1, 99, "Greet", Position{}, "", false},
		{3, 1, "Greet\n", Position{}, "", false},
	} {
		query := Query{Operation: Hover, FilePath: "fixture.go", Line: test.line, Character: test.character}
		position, symbol, err := query.position(test.text)
		if (err == nil) != test.valid || test.valid && (position != test.position || symbol != test.symbol) {
			t.Errorf("cursor line=%d char=%d position=%+v symbol=%q err=%v", test.line, test.character, position, symbol, err)
		}
	}
	text, truncated := (Result{Hover: strings.Repeat("界", 17000)}).Format()
	if !truncated || !strings.HasSuffix(text, "query.]") {
		t.Fatal("large server result was not visibly bounded")
	}
}

func TestFramingRejectsMalformedAndOversizedMessages(t *testing.T) {
	body := `{"jsonrpc":"2.0","result":"界","id":1}`
	frame := fmt.Sprintf("Content-Length: %d\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n%s", len(body), body)
	read, err := readFrame(bufio.NewReader(strings.NewReader(frame)))
	if err != nil || string(read) != body {
		t.Fatalf("UTF-8 Content-Length is bytes: %s %v", read, err)
	}
	for _, frame := range []string{"\r\n", "Content-Length: -1\r\n\r\n", fmt.Sprintf("Content-Length: %d\r\n\r\n", maxMessageBytes+1), "Content-Length: 1\r\nContent-Length: 1\r\n\r\nx", "Content-Length: 5\r\n\r\nx", strings.Repeat("x", 8192) + "\n"} {
		if _, err := readFrame(bufio.NewReader(strings.NewReader(frame))); err == nil {
			t.Fatal("invalid protocol frame accepted")
		}
	}
}

func TestConfigStrictnessDoesNotExposeValues(t *testing.T) {
	for _, suffix := range []string{`,"unknown":"private-canary"`, `,"transport":"socket"`, `,"diagnostics":true`, `,"requestTimeout":0`, `,"maxRestarts":-1`, `,"args":null`, `,"restartOnCrash":null`} {
		raw := `{"go":{"command":"private-canary","extensionToLanguage":{".go":"go"}` + suffix + `}}`
		if _, err := DecodeServers([]byte(raw)); err == nil || strings.Contains(err.Error(), "private-canary") {
			t.Fatalf("configuration invalidity or privacy was lost: %v", err)
		}
	}
	servers, err := DecodeServers([]byte(`{"go":{"command":"private-canary","args":["private-canary"],"env":{"TOKEN":"private-canary"},"settings":{"token":"private-canary"},"extensionToLanguage":{".go":"go"}}}`))
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(servers)
	if err != nil || strings.Contains(string(encoded), "private-canary") {
		t.Fatal("server configuration was included in generic JSON output")
	}
}

func TestCallHierarchyShowsCallerSitesAndRejectsInventedRanges(t *testing.T) {
	item := `{"name":"target","kind":12,"uri":"file:///callee.go","range":{"start":{"line":1,"character":0},"end":{"line":2,"character":0}},"selectionRange":{"start":{"line":1,"character":0},"end":{"line":1,"character":6}}}`
	raw := json.RawMessage(`[{"to":` + item + `,"fromRanges":[{"start":{"line":4,"character":3},"end":{"line":4,"character":9}}]}]`)
	calls, err := decodeCalls(raw, false, "file:///caller.go")
	if err != nil {
		t.Fatal(err)
	}
	text, _ := (Result{Calls: calls}).Format()
	if !strings.Contains(text, "file:///callee.go:2:1") || !strings.Contains(text, "call site: file:///caller.go:5:4") {
		t.Fatal(text)
	}
	if _, err := decodeLocations(json.RawMessage(`[{"uri":"file:///target.go"}]`)); err == nil {
		t.Fatal("missing server range was invented as line one")
	}
}
