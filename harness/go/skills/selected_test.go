package skills

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func selectedFixture(t *testing.T, root, name string) FileSelection {
	t.Helper()
	const source = "---\nname: source\ndescription: source description\n---\nCompiled $ARGUMENTS."
	path := "skills/source/SKILL.md"
	absolute := filepath.Join(root, filepath.FromSlash(path))
	if err := os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(absolute, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	return FileSelection{Root: root, Path: path, Definition: Definition{Summary: Summary{Name: name, Description: "compiled description", Digest: fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(source)))}, Content: "Compiled $ARGUMENTS."}, UserInvocable: true, ModelInvocable: true}
}

func TestCatalogPreloadFindsAQualifiedOrBareName(t *testing.T) {
	requireCatalogPlatform(t)
	root := canonicalTempDir(t)
	selection := selectedFixture(t, root, "sample:source")
	catalog, err := OpenSelected(t.Context(), nil, []FileSelection{selection})
	if err != nil {
		t.Fatal(err)
	}
	defer catalog.Close()
	for _, name := range []string{"sample:source", "source"} {
		body, err := catalog.Preload(t.Context(), name)
		if err != nil || body != "Compiled $ARGUMENTS." {
			t.Fatalf("preload %s = %q %v", name, body, err)
		}
	}
	if _, err := catalog.Preload(t.Context(), "missing"); err == nil {
		t.Fatal("missing skill was preloaded")
	}
}

func TestSelectedVisibilityAndFrozenDefinition(t *testing.T) {
	requireCatalogPlatform(t)
	for _, tc := range []struct {
		name        string
		user, model bool
	}{
		{"both", true, true}, {"user-only", true, false}, {"model-only", false, true}, {"neither", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := canonicalTempDir(t)
			selection := selectedFixture(t, root, "package:source")
			selection.Definition.AllowedTools = []string{"Write"}
			selection.UserInvocable, selection.ModelInvocable = tc.user, tc.model
			catalog, err := OpenSelected(t.Context(), nil, []FileSelection{selection})
			if err != nil {
				t.Fatal(err)
			}
			defer catalog.Close()
			selection.Definition.AllowedTools[0] = "Bash"
			for _, view := range []struct {
				list func(context.Context) ([]Summary, error)
				read func(context.Context, string, string) (Definition, error)
				want bool
			}{{catalog.List, catalog.Read, tc.model}, {catalog.UserList, catalog.ReadUser, tc.user}} {
				rows, err := view.list(t.Context())
				if err != nil || len(rows) != map[bool]int{true: 1, false: 0}[view.want] {
					t.Fatalf("visibility list = %v, %v", rows, err)
				}
				definition, err := view.read(t.Context(), selection.Definition.Name, selection.Definition.Digest)
				if (err == nil) != view.want {
					t.Fatalf("visibility read = %+v, %v", definition, err)
				}
				if view.want && (definition.Name != "package:source" || definition.Description != "compiled description" || definition.Content != selection.Definition.Content || !definition.Claude || definition.ResourceBase != root || definition.Directory != "skills/source") {
					t.Fatalf("compiled definition was reparsed or lost: %+v", definition)
				}
				if view.want {
					if !reflect.DeepEqual(definition.AllowedTools, []string{"Write"}) {
						t.Fatalf("caller changed frozen authorization: %v", definition.AllowedTools)
					}
					definition.AllowedTools[0] = "Edit"
				}
			}
		})
	}
}

func TestSelectedResources(t *testing.T) {
	root := canonicalTempDir(t)
	selection := selectedFixture(t, root, "package:source")
	if err := os.Mkdir(filepath.Join(root, "templates"), 0700); err != nil {
		t.Fatal(err)
	}
	const resource = "templates/report.md"
	if err := os.WriteFile(filepath.Join(root, resource), []byte("# Report template"), 0600); err != nil {
		t.Fatal(err)
	}
	selection.ResourcePaths = []string{resource, resource}
	selection.ModelInvocable = false
	other := selection
	other.Definition.Name = "package:other"
	catalog, err := OpenSelected(t.Context(), nil, []FileSelection{selection, other})
	if err != nil {
		t.Fatal(err)
	}
	defer catalog.Close()
	for _, selected := range []FileSelection{selection, other} {
		paths, err := catalog.ListResources(t.Context(), selected.Definition.Name, selected.Definition.Digest)
		if err != nil || !reflect.DeepEqual(paths, []string{resource}) {
			t.Fatalf("resource manifest = %v, %v", paths, err)
		}
		paths[0] = "changed by caller"
		definition, err := catalog.ReadUser(t.Context(), selected.Definition.Name, selected.Definition.Digest)
		if err != nil || !reflect.DeepEqual(definition.Resources, []string{resource}) {
			t.Fatalf("resource manifest was mutable: %+v, %v", definition, err)
		}
		definition.Resources[0] = "changed again"
		text, err := catalog.ReadResource(t.Context(), selected.Definition.Name, selected.Definition.Digest, resource)
		if err != nil || text.Text != "# Report template" || text.Path != resource || text.Digest == "" {
			t.Fatalf("resource read = %+v, %v", text, err)
		}
	}
	for _, tc := range []struct{ name, digest, path string }{
		{"unknown:source", selection.Definition.Digest, resource},
		{selection.Definition.Name, "stale", resource},
		{selection.Definition.Name, selection.Definition.Digest, "../templates/report.md"},
		{selection.Definition.Name, selection.Definition.Digest, "undeclared.md"},
	} {
		if _, err := catalog.ReadResource(t.Context(), tc.name, tc.digest, tc.path); err == nil {
			t.Fatalf("unselected resource accepted: %+v", tc)
		}
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := catalog.ReadResource(ctx, selection.Definition.Name, selection.Definition.Digest, resource); !errors.Is(err, context.Canceled) {
		t.Fatalf("resource cancellation ignored: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, resource), []byte("changed template"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := catalog.ReadResource(t.Context(), selection.Definition.Name, selection.Definition.Digest, resource); err == nil || !strings.Contains(err.Error(), "restart") {
		t.Fatalf("changed resource accepted: %v", err)
	}
	catalog.Close()
	if _, err := catalog.ListResources(t.Context(), selection.Definition.Name, selection.Definition.Digest); err == nil {
		t.Fatal("closed resource manifest accepted")
	}
}

func TestSelectedSnapshotFailures(t *testing.T) {
	requireCatalogPlatform(t)
	for _, tc := range []struct {
		name   string
		change func(*testing.T, *FileSelection) context.Context
	}{
		{"stale compilation", func(t *testing.T, selection *FileSelection) context.Context {
			selection.Definition.Digest = "sha256:" + strings.Repeat("0", 64)
			return t.Context()
		}},
		{"invalid name", func(t *testing.T, selection *FileSelection) context.Context {
			selection.Definition.Name = "bad:name:extra"
			return t.Context()
		}},
		{"cancelled", func(t *testing.T, selection *FileSelection) context.Context {
			ctx, cancel := context.WithCancel(t.Context())
			cancel()
			return ctx
		}},
		{"resource traversal", func(t *testing.T, selection *FileSelection) context.Context {
			selection.ResourcePaths = []string{"../outside.md"}
			return t.Context()
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			selection := selectedFixture(t, canonicalTempDir(t), "package:source")
			ctx := tc.change(t, &selection)
			catalog, err := OpenSelected(ctx, nil, []FileSelection{selection})
			if err == nil {
				catalog.Close()
				t.Fatal("accepted invalid selection")
			}
		})
	}
	for _, mutation := range []string{"definition changed", "root replaced"} {
		t.Run(mutation, func(t *testing.T) {
			root := canonicalTempDir(t)
			selection := selectedFixture(t, root, "package:source")
			catalog, err := OpenSelected(t.Context(), nil, []FileSelection{selection})
			if err != nil {
				t.Fatal(err)
			}
			defer catalog.Close()
			if mutation == "definition changed" {
				err = os.WriteFile(filepath.Join(root, selection.Path), []byte("changed after launch"), 0600)
			} else {
				err = os.Rename(root, root+"-old")
				if err == nil {
					err = os.Mkdir(root, 0700)
				}
				t.Cleanup(func() { _ = os.RemoveAll(root + "-old") })
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := catalog.ReadUser(t.Context(), selection.Definition.Name, selection.Definition.Digest); err == nil || !strings.Contains(err.Error(), "restart") {
				t.Fatalf("changed selection accepted: %v", err)
			}
		})
	}
}

func TestSelectedScaleAndLegacyComposition(t *testing.T) {
	requireCatalogPlatform(t)
	root := canonicalTempDir(t)
	selection := selectedFixture(t, root, "package:source")
	selected := make([]FileSelection, MaxSelectedSkills)
	for i := range selected {
		selected[i] = selection
		selected[i].Definition.Name = fmt.Sprintf("package:skill-%d", i)
	}
	legacy := canonicalTempDir(t)
	fixture(t, legacy, "legacy", "")
	catalog, err := OpenSelected(t.Context(), []string{legacy}, selected)
	if err != nil {
		t.Fatal(err)
	}
	defer catalog.Close()
	rows, err := catalog.List(t.Context())
	if err != nil || len(rows) != MaxSelectedSkills+1 {
		t.Fatalf("combined catalog = %d, %v", len(rows), err)
	}
	if _, err := OpenSelected(t.Context(), nil, append(selected, selection)); err == nil {
		t.Fatal("selected count limit ignored")
	}
	if _, err := OpenSelected(t.Context(), nil, []FileSelection{selection, selection}); err == nil {
		t.Fatal("duplicate selected name accepted")
	}
	if disabled, err := OpenSelected(t.Context(), nil, nil); disabled != nil || err != nil {
		t.Fatalf("empty selection should be disabled: %v, %v", disabled, err)
	}
}
