package nativetools

import (
	"context"
	"sync"

	"github.com/phodal/pero/harness/go/fstools"
)

type workspaceKey struct{}

var boundWorkspaces sync.Map

// BindIsolatedWorkspace opens a workspace for one detached Git worktree.
// The returned path is the canonical root sessions must use as their cwd.
func BindIsolatedWorkspace(path string) (string, error) {
	files, err := fstools.OpenWorkspace(path)
	if err != nil {
		return "", err
	}
	boundWorkspaces.Store(files.Path(), files)
	return files.Path(), nil
}

// ReleaseIsolatedWorkspace closes a workspace opened by BindIsolatedWorkspace.
func ReleaseIsolatedWorkspace(path string) {
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
	value, ok := boundWorkspaces.Load(path)
	if !ok {
		return false
	}
	return value.(*fstools.Workspace).CheckCWD(path) == nil
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
