package plugins

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSkillHubArchiveAdmission(t *testing.T) {
	for _, tc := range []struct {
		name      string
		members   []string
		errorText string
	}{
		{"static skill and reference", []string{"SKILL.md", "references/notes.md", "references/more.md"}, ""},
		{"parent path", []string{"../outside.md"}, "unsupported path"},
		{"case collision", []string{"SKILL.md", "skill.md"}, "unsupported path"},
		{"implicit directory case collision", []string{"references/Notes/a.md", "references/notes/b.md"}, "unsupported path"},
		{"file collides with implicit directory", []string{"references/Notes/a.md", "references/notes"}, "unsupported path"},
		{"path depth limit", []string{strings.Repeat("Folder/", 65)}, "path exceeds supported limits"},
		{"path length limit", []string{strings.Repeat(strings.Repeat("a", 128)+"/", 32)}, "path exceeds supported limits"},
		{"plugin integration", []string{"hooks/hooks.json"}, "unsupported path"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var buffer bytes.Buffer
			archive := zip.NewWriter(&buffer)
			for _, member := range tc.members {
				writer, err := archive.Create(member)
				if err != nil {
					t.Fatal(err)
				}
				if strings.HasSuffix(member, "/") {
					continue
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
			if tc.errorText != "" {
				if err == nil || !strings.Contains(err.Error(), tc.errorText) {
					t.Fatalf("archive admission = %v, want %q", err, tc.errorText)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				content, err := os.ReadFile(filepath.Join(source, "references", "notes.md"))
				if err != nil || string(content) != "Skill fixture" {
					t.Fatalf("bundled reference = %q, error = %v", content, err)
				}
			}
		})
	}
}
