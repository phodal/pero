package nativetools

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"

	"github.com/phodal/pero/harness/go/fstools"
)

type workspaceKey struct{}

var boundWorkspaces sync.Map
var boundWorkspaceReferences = struct {
	sync.Mutex
	counts map[string]int
}{counts: make(map[string]int)}

// BindIsolatedWorkspace opens a workspace for one detached Git worktree.
// The returned path is the canonical root sessions must use as their cwd.
func BindIsolatedWorkspace(path string) (string, error) {
	files, err := fstools.OpenWorkspace(path)
	if err != nil {
		return "", err
	}
	boundWorkspaceReferences.Lock()
	defer boundWorkspaceReferences.Unlock()
	if existing, ok := boundWorkspaces.Load(files.Path()); ok {
		_ = files.Close()
		if err := existing.(*fstools.Workspace).CheckCWD(files.Path()); err != nil {
			return "", err
		}
	} else {
		boundWorkspaces.Store(files.Path(), files)
	}
	boundWorkspaceReferences.counts[files.Path()]++
	return files.Path(), nil
}

// ReleaseIsolatedWorkspace closes a workspace opened by BindIsolatedWorkspace.
func ReleaseIsolatedWorkspace(path string) {
	boundWorkspaceReferences.Lock()
	defer boundWorkspaceReferences.Unlock()
	if count := boundWorkspaceReferences.counts[path]; count > 1 {
		boundWorkspaceReferences.counts[path] = count - 1
		return
	}
	delete(boundWorkspaceReferences.counts, path)
	value, ok := boundWorkspaces.LoadAndDelete(path)
	if !ok {
		return
	}
	_ = value.(*fstools.Workspace).Close()
}

func (a *App) filesFor(cwd string) *fstools.Workspace {
	if a != nil && a.files != nil && a.files.CheckCWD(cwd) == nil {
		return a.files
	}
	if value, ok := boundWorkspaces.Load(cwd); ok {
		return value.(*fstools.Workspace)
	}
	if a == nil {
		return nil
	}
	return a.files
}

func isolatedWorkdir(path string) bool {
	return workspaceContaining(path) != nil
}

func workspaceContaining(path string) *fstools.Workspace {
	if path == "" {
		return nil
	}
	candidates := []string{path, filepath.Clean(path)}
	if resolved, err := filepath.EvalSymlinks(path); err == nil && resolved != "" {
		candidates = append(candidates, resolved)
	}
	var found *fstools.Workspace
	boundWorkspaces.Range(func(key, value any) bool {
		root, _ := key.(string)
		roots := []string{root}
		if resolved, err := filepath.EvalSymlinks(root); err == nil && resolved != "" {
			roots = append(roots, resolved)
		}
		for _, candidate := range candidates {
			for _, root := range roots {
				if pathWithin(root, candidate) {
					found = value.(*fstools.Workspace)
					return false
				}
			}
		}
		return true
	})
	return found
}

func absoluteToolPath(raw json.RawMessage) string {
	var fields struct {
		Path         string `json:"path"`
		FilePath     string `json:"file_path"`
		NotebookPath string `json:"notebook_path"`
	}
	if json.Unmarshal(raw, &fields) != nil {
		return ""
	}
	for _, path := range []string{fields.FilePath, fields.NotebookPath, fields.Path} {
		if filepath.IsAbs(path) {
			return path
		}
	}
	return ""
}

func pathWithin(root, path string) bool {
	if root == "" || path == "" {
		return false
	}
	if path == root {
		return true
	}
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func withWorkspace(ctx context.Context, files *fstools.Workspace) context.Context {
	return context.WithValue(ctx, workspaceKey{}, files)
}

func workspaceFrom(ctx context.Context, fallback *fstools.Workspace) *fstools.Workspace {
	if files, ok := ctx.Value(workspaceKey{}).(*fstools.Workspace); ok && files != nil {
		return files
	}
	return fallback
}
