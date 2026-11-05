package nativetools

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"sync"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
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

// WorkspaceForAgent selects the session's trusted workspace, including detached
// worktrees. Additional directories are not session working directories.
func WorkspaceForAgent(agent *harness.Agent, fallback *fstools.Workspace) *fstools.Workspace {
	if agent == nil || agent.Session() == nil {
		return fallback
	}
	return workspaceForCWD(agent.Session().WorkingDirectory(), fallback)
}

// WorkspaceForPath selects the caller's authority for an absolute tool path.
// Relative paths remain rooted in the session workspace. Callers must still
// validate the session cwd separately; a directory grant cannot replace it.
func WorkspaceForPath(agent *harness.Agent, fallback *fstools.Workspace, path string) *fstools.Workspace {
	if filepath.IsAbs(path) {
		if added := workspaceContaining(agent, path); added != nil {
			return added
		}
	}
	return WorkspaceForAgent(agent, fallback)
}

// WorkspaceForToolRequest shares native path selection with receipt consumers.
func WorkspaceForToolRequest(request harness.ToolRequest, fallback *fstools.Workspace) *fstools.Workspace {
	return WorkspaceForPath(request.Agent, fallback, absoluteToolPath(request.Arguments))
}

func workspaceForCWD(cwd string, fallback *fstools.Workspace) *fstools.Workspace {
	if fallback != nil && fallback.CheckCWD(cwd) == nil {
		return fallback
	}
	if value, ok := boundWorkspaces.Load(cwd); ok {
		return value.(*fstools.Workspace)
	}
	return fallback
}

func isolatedWorkdir(path string) bool {
	return isolatedWorkspaceContaining(path) != nil
}

func isolatedWorkspaceContaining(path string) *fstools.Workspace {
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

// Added directories belong to a live agent, not to every session using this app.
// Only the explicit Parent chain inherits a grant; revoking the owner also
// removes access from its children.
var agentWorkspaces = struct {
	sync.Mutex
	grants map[*harness.Agent]map[string]*fstools.Workspace
}{grants: make(map[*harness.Agent]map[string]*fstools.Workspace)}

// BindAgentWorkspace grants an additional directory to an agent and its children.
func BindAgentWorkspace(agent *harness.Agent, path string) (string, error) {
	if agent == nil {
		return "", errors.New("added workspace requires an agent")
	}
	files, err := fstools.OpenWorkspace(path)
	if err != nil {
		return "", err
	}
	agentWorkspaces.Lock()
	defer agentWorkspaces.Unlock()
	if agentWorkspaces.grants[agent] == nil {
		agentWorkspaces.grants[agent] = make(map[string]*fstools.Workspace)
	}
	if existing := agentWorkspaces.grants[agent][files.Path()]; existing != nil {
		_ = files.Close()
		return existing.Path(), existing.CheckCWD(existing.Path())
	}
	agentWorkspaces.grants[agent][files.Path()] = files
	return files.Path(), nil
}

// ReleaseAgentWorkspace revokes a directory, including inherited access.
func ReleaseAgentWorkspace(agent *harness.Agent, path string) {
	agentWorkspaces.Lock()
	defer agentWorkspaces.Unlock()
	if files := agentWorkspaces.grants[agent][path]; files != nil {
		delete(agentWorkspaces.grants[agent], path)
		if len(agentWorkspaces.grants[agent]) == 0 {
			delete(agentWorkspaces.grants, agent)
		}
		_ = files.Close()
	}
}

func workspaceContaining(agent *harness.Agent, path string) *fstools.Workspace {
	if path == "" {
		return nil
	}
	path = filepath.Clean(path)
	agentWorkspaces.Lock()
	defer agentWorkspaces.Unlock()
	var selected *fstools.Workspace
	longest := 0
	for owner := agent; owner != nil; owner = owner.Parent() {
		for root, files := range agentWorkspaces.grants[owner] {
			if len(root) > longest && pathWithin(root, path) {
				selected, longest = files, len(root)
			}
		}
	}
	return selected
}
