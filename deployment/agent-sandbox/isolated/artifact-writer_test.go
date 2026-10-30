package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

func TestRuntimeProducedArtifact(t *testing.T) {
	dir := t.TempDir()
	identity := filepath.Join(dir, "run-id")
	destination := filepath.Join(dir, "artifacts", "generated.txt")
	if err := os.WriteFile(identity, []byte("run-fixture\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeArtifact(identity, destination); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	var a generatedArtifact
	if err = json.Unmarshal(data, &a); err != nil {
		t.Fatal(err)
	}
	if a.RunID != "run-fixture" || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(a.Nonce) {
		t.Fatal("missing run-specific artifact identity")
	}
	if err = writeArtifact(identity, destination); err == nil {
		t.Fatal("fixture must never overwrite or replay")
	}
	after, _ := os.ReadFile(destination)
	if string(after) != string(data) {
		t.Fatal("existing generated artifact changed")
	}
}
