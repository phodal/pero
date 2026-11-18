package plugins

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestSkillHubArchiveAdmission(t *testing.T) {
	for _, tc := range []struct {
		name     string
		members  []string
		accepted bool
	}{
		{"static skill and reference", []string{"SKILL.md", "references/notes.md"}, true},
		{"parent path", []string{"../outside.md"}, false},
		{"case collision", []string{"SKILL.md", "skill.md"}, false},
		{"plugin integration", []string{"hooks/hooks.json"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var buffer bytes.Buffer
			archive := zip.NewWriter(&buffer)
			for _, member := range tc.members {
				writer, err := archive.Create(member)
				if err != nil {
					t.Fatal(err)
				}
				if _, err = writer.Write([]byte("Skill fixture")); err != nil {
					t.Fatal(err)
				}
			}
			if err := archive.Close(); err != nil {
				t.Fatal(err)
			}
			source := filepath.Join(t.TempDir(), "source")
			err := unpackSkillHub(buffer.Bytes(), source)
			if (err == nil) != tc.accepted {
				t.Fatalf("archive admission = %v, want accepted %v", err, tc.accepted)
			}
			if tc.accepted {
				content, err := os.ReadFile(filepath.Join(source, "references", "notes.md"))
				if err != nil || string(content) != "Skill fixture" {
					t.Fatalf("bundled reference = %q, error = %v", content, err)
				}
			}
		})
	}
}
