package plugins_test

import (
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/plugins"
	"github.com/phodal/pero/harness/go/skills"
)

func TestFetchSelectedSkill(t *testing.T) {
	writeFiles := func(root string, files map[string]string) {
		t.Helper()
		for relative, content := range files {
			name := filepath.Join(root, filepath.FromSlash(relative))
			if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(name, []byte(content), 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	repo := t.TempDir()
	body := "---\nname: paper-check\ndescription: Check research evidence\nauthor: Orchestra Research\nversion: 1.0.0\nlicense: MIT\ntags: [Research]\ndependencies: [torch]\n---\nMARKET_SOURCE Read ./references/check.md.\nCite [references](../../shared/references.bib) and read [methods](../../shared/docs/methods.md).\nA prose ../ example is not a resource reference.\n"
	writeFiles(repo, map[string]string{
		"skills/paper-check/SKILL.md":            body,
		"skills/paper-check/references/check.md": "REFERENCE_EVIDENCE",
		"skills/unselected/SKILL.md":             "---\nname: unselected\ndescription: Not selected\n---\nUNSELECTED_EVIDENCE",
		"skills/unselected/large-data.txt":       strings.Repeat("UNSELECTED_LARGE_DATA\n", 400000),
		"skills/escaping/SKILL.md":               "---\nname: escaping\ndescription: Invalid resource\n---\nRead [outside](../../../outside.md).",
		"shared/references.bib":                  "@article{observed,title={Observed evidence}}",
		"shared/docs/methods.md":                 "Use the [glossary](glossary.md), [references](../references.bib), and related [skill](../../skills/unselected/SKILL.md). [Hook](../../hooks/hooks.json)",
		"shared/docs/glossary.md":                "A claim needs observed evidence. [Methods](methods.md)",
		".claude-plugin/marketplace.json":        `{"plugins":[{"name":"must-not-fetch","source":{"source":"url","url":"https://invalid.invalid/must-not-fetch"}}]}`,
		".mcp.json":                              `{"mcpServers":{"must-not-start":{"command":"must-not-run"}}}`,
		"hooks/hooks.json":                       `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"must-not-run"}]}]}}`,
	})
	git := func(args ...string) string {
		t.Helper()
		command := exec.Command("git", append([]string{"-C", repo}, args...)...)
		command.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.invalid", "GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.invalid")
		out, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("git: %v %s", err, out)
		}
		return strings.TrimSpace(string(out))
	}
	git("init", "-q")
	git("add", ".")
	git("commit", "-qm", "fixture")
	commit := git("rev-parse", "HEAD")
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(body)))
	cache := t.TempDir()
	first, err := plugins.FetchSkill(t.Context(), repo, cache, commit, "skills/paper-check/SKILL.md", "market-test", digest)
	if err != nil {
		t.Fatal(err)
	}
	if first.Revision != commit || first.SHA256 != digest || first.Invocation != "market-test:paper-check" {
		t.Fatalf("receipt %+v", first)
	}
	loaded, err := plugins.LoadPackages(t.Context(), []string{first.Directory})
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded) != 1 || len(loaded[0].Definition.Components) != 1 || !strings.Contains(loaded[0].Definition.Components[0].Content, "MARKET_SOURCE") {
		t.Fatalf("selection: %+v", loaded)
	}
	for _, resource := range loaded[0].Resources {
		if strings.Contains(resource, "unselected") || strings.Contains(resource, "hooks/") {
			t.Fatalf("unselected source exposed: %s", resource)
		}
	}
	ref, err := os.ReadFile(filepath.Join(first.Directory, "source", "skills", "paper-check", "references", "check.md"))
	if err != nil || string(ref) != "REFERENCE_EVIDENCE" {
		t.Fatalf("resource %s %v", ref, err)
	}
	for _, path := range []string{"shared/references.bib", "shared/docs/methods.md", "shared/docs/glossary.md"} {
		if _, err := os.Stat(filepath.Join(first.Directory, "source", filepath.FromSlash(path))); err != nil {
			t.Fatalf("missing referenced resource %s: %v", path, err)
		}
	}
	if !slices.Contains(loaded[0].Resources, "source/shared/references.bib") {
		t.Fatal("Bibliography is not an admitted package resource")
	}
	component := loaded[0].Definition.Components[0]
	catalog, err := skills.OpenSelected(t.Context(), nil, []skills.FileSelection{{
		Root: loaded[0].Root, Path: component.Path,
		Definition:    skills.Definition{Summary: skills.Summary{Name: component.QualifiedName, Description: component.Description, Digest: component.Digest}, Content: component.Content},
		UserInvocable: component.Visibility.User, ModelInvocable: component.Visibility.Model, ResourcePaths: loaded[0].Resources,
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer catalog.Close()
	bibliography, err := catalog.ReadResource(t.Context(), component.QualifiedName, component.Digest, "source/shared/references.bib")
	if err != nil || bibliography.Text != "@article{observed,title={Observed evidence}}" {
		t.Fatalf("Harness bibliography read = %+v, %v", bibliography, err)
	}
	var installedBytes int64
	if err := filepath.WalkDir(first.Directory, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Name() == ".git" || entry.Name() == ".original" {
			return fmt.Errorf("repository retained in installed view: %s", entry.Name())
		}
		if !entry.IsDir() {
			info, err := entry.Info()
			if err != nil {
				return err
			}
			installedBytes += info.Size()
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if installedBytes > 1024*1024 {
		t.Fatalf("Unselected repository content was retained: %d bytes", installedBytes)
	}
	if _, err := plugins.FetchSkill(t.Context(), repo, cache, commit, "skills/escaping/SKILL.md", "market-test", ""); err == nil {
		t.Fatal("repository-escaping Markdown reference accepted")
	}
	for _, invalid := range []struct{ path, digest string }{{"../outside/SKILL.md", digest}, {"skills/paper-check/SKILL.md", strings.Repeat("0", 64)}, {"skills/unselected/SKILL.md", digest}} {
		if _, err := plugins.FetchSkill(t.Context(), repo, cache, commit, invalid.path, "market-test", invalid.digest); err == nil {
			t.Fatal("invalid selected source accepted")
		}
	}
	entries, _ := os.ReadDir(cache)
	if len(entries) != 1 {
		t.Fatalf("failed fetch leaked %d snapshots", len(entries))
	}
	// A root skill also installs without retaining its Git database or integrations.
	repo = t.TempDir()
	rootBody := "---\nname: root-evidence\ndescription: Root research skill\n---\nRead [guide](README.md)."
	writeFiles(repo, map[string]string{"SKILL.md": rootBody, "README.md": "Root evidence guide.", ".mcp.json": `{"mcpServers":{"not-selected":{"command":"must-not-run"}}}`, "hooks/hooks.json": `{"hooks":{}}`})
	git("init", "-q")
	git("add", ".")
	git("commit", "-qm", "root fixture")
	rootReceipt, err := plugins.FetchSkill(t.Context(), repo, t.TempDir(), git("rev-parse", "HEAD"), "SKILL.md", "market-root", fmt.Sprintf("%x", sha256.Sum256([]byte(rootBody))))
	if err != nil {
		t.Fatal(err)
	}
	executable := filepath.Join(repo, "run-helper.bin")
	if err := os.WriteFile(executable, []byte("not text"), 0755); err != nil {
		t.Fatal(err)
	}
	git("add", ".")
	git("commit", "-qm", "executable resource")
	executableReceipt, err := plugins.FetchSkill(t.Context(), repo, t.TempDir(), git("rev-parse", "HEAD"), "SKILL.md", "market-root", fmt.Sprintf("%x", sha256.Sum256([]byte(rootBody))))
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(executableReceipt.Directory, "source", "run-helper.bin"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0111 != 0 {
		t.Fatalf("copied non-text file kept executable mode %o", info.Mode().Perm())
	}
	if err := filepath.WalkDir(rootReceipt.Directory, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Name() == ".git" || entry.Name() == ".original" || entry.Name() == ".mcp.json" || entry.Name() == "hooks" {
			return fmt.Errorf("unselected repository integration retained: %s", entry.Name())
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestSkillFetchSafety(t *testing.T) {
	for _, source := range []string{"ssh://github.com/owner/repo.git", "https://example.com/owner/repo.git", "https://github.com/owner/repo/extra.git", "/tmp/local-repo"} {
		if err := plugins.PublicGitHubSkillSource(source); err == nil {
			t.Fatalf("accepted source %s", source)
		}
	}
	if err := plugins.PublicGitHubSkillSource("https://github.com/owner/repo.git"); err != nil {
		t.Fatal(err)
	}
	repo := t.TempDir()
	body := "---\nname: fenced\ndescription: Dynamic fence\n---\n```!\necho must-not-run\n```\n"
	path := filepath.Join(repo, "SKILL.md")
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	git := func(args ...string) string {
		t.Helper()
		command := exec.Command("git", append([]string{"-C", repo}, args...)...)
		command.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.invalid", "GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.invalid")
		out, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("git: %v %s", err, out)
		}
		return strings.TrimSpace(string(out))
	}
	git("init", "-q")
	git("add", ".")
	git("commit", "-qm", "fence")
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(body)))
	if _, err := plugins.FetchSkill(t.Context(), repo, t.TempDir(), git("rev-parse", "HEAD"), "SKILL.md", "market-test", digest); err == nil || !strings.Contains(err.Error(), "dynamic commands") {
		t.Fatalf("fenced dynamic command accepted: %v", err)
	}
	oversized := strings.Repeat("x", (1<<20)+1)
	if err := os.WriteFile(path, []byte(oversized), 0600); err != nil {
		t.Fatal(err)
	}
	git("add", ".")
	git("commit", "-qm", "oversized")
	prefix := oversized[:1<<20]
	if _, err := plugins.FetchSkill(t.Context(), repo, t.TempDir(), git("rev-parse", "HEAD"), "SKILL.md", "market-test", fmt.Sprintf("%x", sha256.Sum256([]byte(prefix)))); err == nil || strings.Contains(err.Error(), "differs from catalog") || !strings.Contains(err.Error(), "size limit") {
		t.Fatalf("oversized skill misreported integrity: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repo, "payload.bin"), []byte(strings.Repeat("y", (8<<20)+1)), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	git("add", ".")
	git("commit", "-qm", "too large")
	if _, err := plugins.FetchSkill(t.Context(), repo, t.TempDir(), git("rev-parse", "HEAD"), "SKILL.md", "market-test", digest); err == nil || !strings.Contains(err.Error(), "size limit") {
		t.Fatalf("oversized directory accepted: %v", err)
	}
}
