package researchprofile

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/phodal/pero/harness/go/plugins"
)

func TestInspectedSourceAndOriginalValidatorOptIn(t *testing.T) {
	source, python := os.Getenv("PERO_RESEARCH_SOURCE"), os.Getenv("PERO_RESEARCH_PYTHON")
	if source == "" || python == "" {
		t.Skip("select the inspected source and isolated Python with PERO_RESEARCH_SOURCE / PERO_RESEARCH_PYTHON")
	}
	state := t.TempDir()
	profile, err := Prepare(t.Context(), Options{SourceRoot: source, StateDirectory: state, Python: python})
	if err != nil {
		t.Fatal(err)
	}
	packages, err := plugins.LoadPackages(t.Context(), []string{profile.Directory})
	if err != nil {
		t.Fatal(err)
	}
	if len(packages) != 1 || len(packages[0].Definition.Components) != 7 {
		t.Fatal("original five skills, agent and compatibility entry were not compiled")
	}
	if profile.Provenance.Revision != "6ce38f60e3f8b22502c29873f96503a4e0c5addb" {
		t.Fatal("source revision changed without inspection")
	}
	upstream, err := os.ReadFile(filepath.Join(profile.Directory, "skills/research/validate_json.upstream.py"))
	if err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(filepath.Join(source, "skills/research-zh/research/validate_json.py"))
	if err != nil || string(upstream) != string(original) {
		t.Fatal("source validator body was rewritten")
	}
	work := t.TempDir()
	fields := filepath.Join(work, "fields.yaml")
	if err := os.WriteFile(fields, []byte("fields:\n  basic_info:\n    - {name: name, detail_level: brief}\n    - {name: summary, detail_level: detailed}\n    - {name: sources, detail_level: detailed}\nuncertain: []\n"), 0600); err != nil {
		t.Fatal(err)
	}
	good, bad := filepath.Join(work, "good.json"), filepath.Join(work, "bad.json")
	if err := os.WriteFile(good, []byte(`{"name":"对象","summary":"已核对说明","sources":["https://example.test/evidence"]}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bad, []byte(`{"name":"对象","sources":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	validator := filepath.Join(profile.Directory, "skills/research/validate_json.py")
	for _, test := range []struct {
		name  string
		args  []string
		valid bool
	}{
		{"complete original schema", []string{"-f", fields, "-j", good}, true},
		{"missing required field", []string{"-f", fields, "-j", bad}, false},
		{"missing JSON", []string{"-f", fields, "-j", filepath.Join(work, "missing.json")}, false},
		{"empty explicit selection", []string{"-f", fields, "-j"}, false},
		{"empty result directory", []string{"-f", fields, "-d", filepath.Join(work, "absent")}, false},
		{"explicit missing schema", []string{"-f", filepath.Join(work, "missing.yaml"), "-j", good}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			args := append([]string{"-I", "-B", validator}, test.args...)
			command := exec.CommandContext(t.Context(), python, args...)
			command.Dir = work
			output, err := command.CombinedOutput()
			if (err == nil) != test.valid {
				t.Fatalf("validator exit mismatch: %v %s", err, output)
			}
		})
	}
	replay, err := Prepare(t.Context(), Options{SourceRoot: source, StateDirectory: state, Python: python})
	if err != nil || replay.Digest != profile.Digest || replay.Directory != profile.Directory {
		t.Fatalf("original-source replay was not deterministic: %v", err)
	}
	redirected, other := t.TempDir(), t.TempDir()
	if err := os.Symlink(other, filepath.Join(redirected, "research")); err == nil {
		if _, err := Prepare(t.Context(), Options{SourceRoot: source, StateDirectory: redirected, Python: python}); err == nil {
			t.Fatal("Prepare followed a pre-existing snapshot parent symlink")
		}
		entries, err := os.ReadDir(other)
		if err != nil || len(entries) != 0 {
			t.Fatal("Prepare wrote a snapshot outside the selected state directory")
		}
	}
}
