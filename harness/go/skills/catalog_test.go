package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
)

// The catalog requires explicit canonical roots. On macOS the OS temporary
// directory can contain /var -> /private/var; canonicalize trusted fixture
// creation only, never the roots supplied to the production admission boundary.
func canonicalTempDir(t *testing.T) string {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func requireCatalogPlatform(t *testing.T) {
	t.Helper()
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("positive descriptor-bound catalog contract requires Linux or Darwin; unsupported admission tested separately")
	}
}

func fixture(t *testing.T, root, name, text string) string {
	t.Helper()
	dir := filepath.Join(root, name)
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "SKILL.md")
	if text == "" {
		text = fmt.Sprintf("---\nname: %s\ndescription: Example instructions\n---\nDo not execute scripts automatically.\n", name)
	}
	if err := os.WriteFile(path, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}
func TestCatalogReadAndChange(t *testing.T) {
	requireCatalogPlatform(t)
	root := canonicalTempDir(t)
	path := fixture(t, root, "demo", "")
	c, err := Open(t.Context(), []string{root})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	rows, err := c.List(t.Context())
	if err != nil || len(rows) != 1 {
		t.Fatalf("%+v %v", rows, err)
	}
	d, err := c.Read(t.Context(), "demo", rows[0].Digest)
	if err != nil || !strings.Contains(d.Content, "automatically") {
		t.Fatalf("%+v %v", d, err)
	}
	if _, err = c.Read(t.Context(), "demo", "old"); err == nil {
		t.Fatal("stale digest")
	}
	if _, err = c.Read(t.Context(), "../other", rows[0].Digest); err == nil {
		t.Fatal("path lookup")
	}
	if err = os.WriteFile(path, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = c.Read(t.Context(), "demo", rows[0].Digest); err == nil {
		t.Fatal("silently refreshed content")
	}
	fixture(t, root, "new", "")
	rows, _ = c.List(t.Context())
	if len(rows) != 1 {
		t.Fatal("silently discovered new skill")
	}
	c.Close()
	if _, err = c.List(t.Context()); err == nil {
		t.Fatal("closed catalog readable")
	}
}
func TestDiscoveryFailures(t *testing.T) {
	requireCatalogPlatform(t)
	for _, tc := range []struct{ name, text string }{
		{"missing-header", "body"}, {"wrong-name", "---\nname: other\ndescription: nope\n---\nbody"},
		{"binary", "\x00"}, {"utf8", string([]byte{0xff})}, {"oversize", strings.Repeat("x", MaxFileBytes+1)},
		{"description", "---\nname: demo\ndescription: " + strings.Repeat("x", 1025) + "\n---\nbody"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := canonicalTempDir(t)
			fixture(t, root, "demo", tc.text)
			c, e := Open(t.Context(), []string{root})
			if e == nil {
				c.Close()
				t.Fatal("accepted invalid skill")
			}
		})
	}
	root := canonicalTempDir(t)
	fixture(t, root, "demo", "")
	other := canonicalTempDir(t)
	fixture(t, other, "demo", "")
	for _, roots := range [][]string{nil, {""}, {root, root}, {root, other}, make([]string, MaxRoots+1)} {
		c, e := Open(t.Context(), roots)
		if e == nil {
			c.Close()
			t.Fatal("accepted invalid roots/duplicate name")
		}
	}
}
func TestNoImplicitRootsAndDepth(t *testing.T) {
	requireCatalogPlatform(t)
	home := canonicalTempDir(t)
	fixture(t, filepath.Join(home, ".dsh", "skills"), "hidden", "")
	t.Setenv("HOME", home)
	t.Setenv("DSH_HOME", filepath.Join(home, ".dsh"))
	root := canonicalTempDir(t)
	fixture(t, filepath.Join(root, "nested"), "deep", "")
	fixture(t, root, "disabled", "---\nname: disabled\ndescription: human only\ndisable-model-invocation: true\n---\nbody")
	c, e := Open(t.Context(), []string{root})
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	rows, e := c.List(t.Context())
	if e != nil || len(rows) != 0 {
		t.Fatalf("unexpected discovery: %+v %v", rows, e)
	}
	if _, e = c.Read(t.Context(), "disabled", ""); e == nil {
		t.Fatal("disabled exposed")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, e = c.List(ctx); e == nil {
		t.Fatal("ignored cancel")
	}
}
func TestSymlinksAndReplacement(t *testing.T) {
	requireCatalogPlatform(t)
	root := canonicalTempDir(t)
	outside := canonicalTempDir(t)
	fixture(t, outside, "outside", "")
	if e := os.Symlink(filepath.Join(outside, "outside"), filepath.Join(root, "escape")); e != nil {
		t.Skip(e)
	}
	c, e := Open(t.Context(), []string{root})
	if e != nil {
		t.Fatal(e)
	}
	rows, _ := c.List(t.Context())
	c.Close()
	if len(rows) != 0 {
		t.Fatal("followed directory symlink")
	}
	path := fixture(t, root, "demo", "")
	os.Remove(path)
	os.Symlink(filepath.Join(outside, "outside", "SKILL.md"), path)
	if c, e = Open(t.Context(), []string{root}); e == nil {
		c.Close()
		t.Fatal("followed file symlink")
	}
	os.Remove(path)
	fixture(t, root, "demo", "")
	c, e = Open(t.Context(), []string{root})
	if e != nil {
		t.Fatal(e)
	}
	defer c.Close()
	rows, _ = c.List(t.Context())
	os.Rename(filepath.Join(root, "demo"), filepath.Join(root, "old"))
	os.Symlink(filepath.Join(outside, "outside"), filepath.Join(root, "demo"))
	if _, e = c.Read(t.Context(), "demo", rows[0].Digest); e == nil {
		t.Fatal("parent replacement accepted")
	}
	link := filepath.Join(canonicalTempDir(t), "link")
	os.Symlink(root, link)
	if c, e = Open(t.Context(), []string{link}); e == nil {
		c.Close()
		t.Fatal("root symlink accepted")
	}
}
func TestLimits(t *testing.T) {
	requireCatalogPlatform(t)
	t.Run("entries", func(t *testing.T) {
		root := canonicalTempDir(t)
		for i := 0; i <= MaxEntries; i++ {
			if e := os.WriteFile(filepath.Join(root, fmt.Sprint(i)), nil, 0600); e != nil {
				t.Fatal(e)
			}
		}
		if c, e := Open(t.Context(), []string{root}); e == nil {
			c.Close()
			t.Fatal("entry limit ignored")
		}
	})
	t.Run("skills", func(t *testing.T) {
		root := canonicalTempDir(t)
		for i := 0; i <= MaxSkills; i++ {
			fixture(t, root, fmt.Sprintf("skill-%d", i), "")
		}
		if c, e := Open(t.Context(), []string{root}); e == nil {
			c.Close()
			t.Fatal("count limit ignored")
		}
	})
}
func TestToolUsesExistingRegistry(t *testing.T) {
	requireCatalogPlatform(t)
	ctx := t.Context()
	h, e := harness.Boot(ctx, harness.Options{})
	if e != nil {
		t.Fatal(e)
	}
	var c *Catalog
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()); c.Close() }()
	if off, e := Mount(ctx, h, nil); e != nil || off != nil {
		t.Fatalf("off: %v %v", off, e)
	}
	root := canonicalTempDir(t)
	path := fixture(t, root, "demo", "")
	fixture(t, root, "disabled", "---\nname: disabled\ndescription: hidden summary\ndisable-model-invocation: true\n---\nsecret body")
	offAgent, e := h.Agents().Create(ctx, harness.AgentOptions{ID: "skills-off", CWD: root})
	if e != nil {
		t.Fatal(e)
	}
	if schemas, err := h.Tools().SchemasForAgent(ctx, offAgent); err != nil || len(schemas) != 0 {
		t.Fatalf("default-off exposed tools: %+v %v", schemas, err)
	}
	c, e = Mount(ctx, h, []string{root})
	if e != nil {
		t.Fatal(e)
	}
	a, e := h.Agents().Create(ctx, harness.AgentOptions{ID: "skills", CWD: root})
	if e != nil {
		t.Fatal(e)
	}
	a.Session().Append("turn/start", map[string]int{"turn": 1})
	run := func(args string) harness.ToolResult {
		out, e := h.Tools().Execute(ctx, harness.ToolRequest{Agent: a, Name: "skill", CallID: "call", Arguments: json.RawMessage(args)})
		if e != nil {
			t.Fatal(e)
		}
		return out.Result
	}
	result := run(`{}`)
	if result.IsError {
		t.Fatalf("%+v", result)
	}
	var rows []Summary
	if e = json.Unmarshal([]byte(result.Content[0].Text), &rows); e != nil || len(rows) != 1 {
		t.Fatalf("%+v %v", result, e)
	}
	schemas, e := h.Tools().SchemasForAgent(ctx, a)
	if e != nil || len(schemas) != 1 || schemas[0].Name != "skill" {
		t.Fatalf("unexpected tool authority: %+v %v", schemas, e)
	}
	description := schemas[0].Description
	if !strings.Contains(description, `"name":"demo"`) || !strings.Contains(description, `"description":"Example instructions"`) {
		t.Fatalf("skill relevance was not discoverable: %s", description)
	}
	for _, forbidden := range []string{root, rows[0].Digest, "automatically", "hidden summary", "secret body"} {
		if strings.Contains(description, forbidden) {
			t.Fatalf("advertisement exposed body, digest, path or disabled skill: %s", forbidden)
		}
	}
	raw, _ := json.Marshal(map[string]string{"name": "demo", "digest": rows[0].Digest})
	if got := run(string(raw)); got.IsError || !strings.Contains(got.Content[0].Text, "automatically") {
		t.Fatalf("%+v", got)
	}
	for _, bad := range []string{`{"root":"/"}`, `{"path":"/etc/passwd"}`, `{"Name":"demo"}`, `{"name":"demo"}`, `{"name":"demo","digest":"wrong"}`} {
		if !run(bad).IsError {
			t.Fatalf("authority widened: %s", bad)
		}
	}
	if e = os.WriteFile(path, []byte("changed after advertisement"), 0600); e != nil {
		t.Fatal(e)
	}
	fixture(t, root, "new", "")
	if got := run(string(raw)); !got.IsError {
		t.Fatal("advertising a summary bypassed stale-content rejection")
	}
	if schemas, err := h.Tools().SchemasForAgent(ctx, a); err != nil || schemas[0].Description != description {
		t.Fatal("advertisement silently refreshed after catalog change")
	}
}

func TestDiscoveryRootABAFailsBeforeContentRead(t *testing.T) {
	requireCatalogPlatform(t)
	parent := canonicalTempDir(t)
	root, substitute, saved := filepath.Join(parent, "root"), filepath.Join(parent, "substitute"), filepath.Join(parent, "saved")
	fixture(t, root, "demo", "")
	fixture(t, substitute, "demo", "---\nname: demo\ndescription: must not leak\n---\nunauthorized")
	c := &Catalog{entries: map[string]entry{}}
	defer c.Close()
	swapped := false
	restore := func() {
		if !swapped {
			return
		}
		if e := os.Rename(root, substitute); e != nil {
			t.Fatal(e)
		}
		if e := os.Rename(saved, root); e != nil {
			t.Fatal(e)
		}
		swapped = false
	}
	defer restore()
	c.openFiles = func(path string, paths []string, limit int64) (*fstools.ScopedTextFiles, error) {
		if err := os.Rename(root, saved); err != nil {
			t.Fatal(err)
		}
		if err := os.Rename(substitute, root); err != nil {
			t.Fatal(err)
		}
		swapped = true
		return fstools.OpenScopedTextFiles(path, paths, limit)
	}
	// Without the identity check, read B while its pathname still matches, then
	// restore A before scan's final check: the vulnerable implementation succeeds.
	c.afterRead = restore
	visited := 0
	err := c.scan(t.Context(), root, &visited)
	if err == nil || !strings.Contains(err.Error(), "selected root differs") {
		t.Fatalf("ABA not rejected at binding boundary: %v", err)
	}
	if len(c.entries) != 0 {
		t.Fatal("substitute root metadata entered catalog")
	}
}
func TestRootReplacementAfterOpen(t *testing.T) {
	requireCatalogPlatform(t)
	parent := canonicalTempDir(t)
	root := filepath.Join(parent, "root")
	fixture(t, root, "demo", "")
	c, err := Open(t.Context(), []string{root})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	rows, _ := c.List(t.Context())
	if err = os.Rename(root, filepath.Join(parent, "old")); err != nil {
		t.Fatal(err)
	}
	fixture(t, root, "demo", "")
	if _, err = c.Read(t.Context(), "demo", rows[0].Digest); err == nil {
		t.Fatal("replacement root accepted")
	}
}

func TestFrontmatterAndScriptsAreInertData(t *testing.T) {
	requireCatalogPlatform(t)
	root := canonicalTempDir(t)
	marker := filepath.Join(root, "executed")
	body := "{{ template }} $(touch " + marker + ")\nRead resources only with separately authorized tools."
	text := "---\nname: demo\ndescription: inert data\nallowed-tools: [shell]\npermissions: full-access\nmetadata: {template: '{{ execute }}'}\nimports: [/outside/private]\nscript: ./run.sh\n---\n" + body
	fixture(t, root, "demo", text)
	if err := os.WriteFile(filepath.Join(root, "demo", "run.sh"), []byte("touch "+marker), 0700); err != nil {
		t.Fatal(err)
	}
	c, err := Open(t.Context(), []string{root})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	rows, _ := c.List(t.Context())
	d, err := c.Read(t.Context(), "demo", rows[0].Digest)
	if err != nil || d.Content != body {
		t.Fatalf("data was interpreted: %+v %v", d, err)
	}
	if _, err = os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("skill script executed")
	}
	c.Close()
	if _, err = c.Read(t.Context(), "demo", rows[0].Digest); err == nil {
		t.Fatal("read after close")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if c, err := Open(ctx, []string{root}); err == nil {
		c.Close()
		t.Fatal("cancelled discovery succeeded")
	}
}

func TestUnsupportedCatalogAdmission(t *testing.T) {
	if runtime.GOOS == "linux" || runtime.GOOS == "darwin" {
		t.Skip("unsupported-platform contract")
	}
	root := canonicalTempDir(t)
	path := fixture(t, root, "demo", "")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	c, err := Open(t.Context(), []string{root})
	// The valid fixture reaches the explicitly unsupported descriptor boundary.
	if c != nil || err == nil || !strings.Contains(err.Error(), "supported descriptor-rooted Unix") {
		t.Fatalf("catalog admission: %v %v", c, err)
	}
	after, err := os.ReadFile(path)
	if err != nil || string(after) != string(before) {
		t.Fatalf("unsupported admission mutated source: %v", err)
	}
}
func TestFrontmatterParsingPlatformIndependent(t *testing.T) {
	for _, tc := range []struct {
		text                string
		wantError, disabled bool
	}{
		{text: "---\nname: demo\ndescription: data only\n---\n$(do not execute)"},
		{text: "---\nname: demo\ndescription: data only\ndisable-model-invocation: true\n---\nbody", disabled: true},
		{text: "body without header", wantError: true},
	} {
		def, disabled, err := parse(tc.text)
		if (err != nil) != tc.wantError || disabled != tc.disabled {
			t.Fatalf("parse: %+v %v %v", def, disabled, err)
		}
		if !tc.wantError && (def.Name != "demo" || def.Description != "data only") {
			t.Fatalf("metadata: %+v", def)
		}
	}
}
