package researchprofile

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSnapshotPublicationIsReplayableAndRejectsRedirectedParent(t *testing.T) {
	files := []preparedFile{{path: "skills/check/SKILL.md", text: "selected workflow"}, {path: "LICENSE", text: "fixture license"}}
	state := t.TempDir()
	first, err := publish(t.Context(), state, "fixture-digest", files)
	if err != nil {
		t.Fatal(err)
	}
	second, err := publish(t.Context(), state, "fixture-digest", files)
	if err != nil || first != second {
		t.Fatalf("snapshot replay changed identity: %v", err)
	}
	if err := os.WriteFile(filepath.Join(first, "LICENSE"), []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := publish(t.Context(), state, "fixture-digest", files); err == nil {
		t.Fatal("changed existing snapshot was reused")
	}
	redirected, other := t.TempDir(), t.TempDir()
	if err := os.Symlink(other, filepath.Join(redirected, "research")); err != nil {
		t.Skipf("symlink fixture unavailable: %v", err)
	}
	if _, err := publish(t.Context(), redirected, "fixture-digest", files); err == nil {
		t.Fatal("snapshot parent symlink was followed")
	}
	entries, err := os.ReadDir(other)
	if err != nil || len(entries) != 0 {
		t.Fatal("snapshot wrote outside the selected state root")
	}
	cancelled, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := publish(cancelled, t.TempDir(), "cancelled", files); err == nil {
		t.Fatal("cancelled publication was accepted")
	}
}

func TestSourceAdaptationPreservesOriginalBehaviorAndRecordsChanges(t *testing.T) {
	source := sourceSpecification{Repository: "fixture", Revision: "fixed", License: "MIT"}
	files := []selectedFile{}
	for _, entry := range []struct{ path, text string }{
		{"agents/web-search-agent.md", "---\nname: web-search-agent\nmodel: opus\n---\nRead ~/.claude/agents/web-search-modules/general-web.md"},
		{"skills/research-zh/research-deep/SKILL.md", "allowed-tools: Task\npython ~/.claude/skills/research/validate_json.py -f {fields_path} -j {output_path}"},
		{"skills/research-zh/research-report/SKILL.md", "python {topic}/generate_report.py"},
		{"skills/research-zh/research/validate_json.py", "# unchanged upstream validator\n"},
	} {
		files = append(files, selectedFile{specification: sourceFile{Path: entry.path, SHA256: digest(entry.text)}, text: entry.text})
	}
	prepared, provenance, key, err := assemble(source, files, "/selected path/python3", "6.0.3")
	if err != nil {
		t.Fatal(err)
	}
	if key == "" || len(provenance.Operations) != len(files)+3 {
		t.Fatal("adaptation omitted provenance")
	}
	seen := map[string]string{}
	for _, file := range prepared {
		seen[file.path] = file.text
	}
	if seen["skills/research/validate_json.upstream.py"] != files[3].text || !strings.Contains(seen["agents/web-search-agent.md"], "model: opus") || !strings.Contains(seen["skills/research-deep/SKILL.md"], "Task") {
		t.Fatal("adapter changed source validator/model/tool contracts")
	}
	if strings.Contains(seen["agents/web-search-agent.md"], "~/.claude") || !strings.Contains(seen["skills/research-deep/SKILL.md"], `'/selected path/python3' -I -B`) {
		t.Fatal("global path or interpreter dependency was not explicitly relocated")
	}
	if strings.Contains(seen["skills/deep-research/SKILL.md"], "context: fork") || !strings.Contains(seen["skills/deep-research/SKILL.md"], "deep-research:research-report") {
		t.Fatal("root human gates or original report phase were lost")
	}
	files[0].text += " changed"
	if _, _, _, err := assemble(source, files, "python3", "6.0.3"); err == nil {
		t.Fatal("uninspected source bytes accepted")
	}
	encoded, err := json.Marshal(provenance)
	if err != nil || !strings.Contains(string(encoded), "beforeSHA256") {
		t.Fatal("source adaptation is not reviewable")
	}
}
