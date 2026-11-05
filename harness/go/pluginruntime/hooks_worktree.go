package pluginruntime

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
	"github.com/phodal/pero/harness/go/subagents"
)

// CreateIsolatedWorktree lets a WorktreeCreate hook replace git worktree add.
// The returned cleanup releases the file-tool binding and leaves the directory
// in place. Subagent completion does not run WorktreeRemove.
func (app *HookApp) CreateIsolatedWorktree(ctx context.Context, parent *harness.Agent) (string, func(), error) {
	if app == nil || parent == nil {
		return "", nil, errors.New("plugin-runtime: worktree hook requires an agent")
	}
	if !app.hasHookEvent("WorktreeCreate") {
		return "", nil, subagents.ErrDefaultWorktree
	}
	name, err := worktreeName()
	if err != nil {
		return "", nil, err
	}
	decision, err := app.event(ctx, parent, claudehooks.Input{Event: "WorktreeCreate", Name: name})
	if err != nil {
		return "", nil, err
	}
	if decision.Block || strings.TrimSpace(decision.WorktreePath) == "" {
		reason := decision.Reason
		if reason == "" {
			reason = "WorktreeCreate hook did not return a directory"
		}
		return "", nil, errors.New(reason)
	}
	path, err := acceptWorktreePath(parent.Session().WorkingDirectory(), decision.WorktreePath)
	if err != nil {
		return "", nil, err
	}
	bound, err := nativetools.BindIsolatedWorkspace(path)
	if err != nil {
		return "", nil, err
	}
	return bound, func() { nativetools.ReleaseIsolatedWorkspace(bound) }, nil
}

func (app *HookApp) hasHookEvent(event string) bool {
	for _, pkg := range app.packages {
		for _, hook := range pkg.Hooks {
			if hook.Event == event {
				return true
			}
		}
	}
	return false
}

func worktreeName() (string, error) {
	var buf [4]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return "worktree-" + hex.EncodeToString(buf[:]), nil
}

func acceptWorktreePath(cwd, raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("plugin-runtime: WorktreeCreate hook did not return a directory")
	}
	slash := strings.ReplaceAll(raw, "\\", "/")
	if filepath.IsAbs(raw) && (strings.Contains(slash, "/../") || strings.Contains(slash, "/./") || strings.HasSuffix(slash, "/..") || strings.HasSuffix(slash, "/.") || slash == "." || slash == "..") {
		return "", errors.New("plugin-runtime: worktree path must not contain . or ..")
	}
	path := raw
	if !filepath.IsAbs(path) {
		path = filepath.Join(cwd, path)
	}
	path = filepath.Clean(path)
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("plugin-runtime: worktree path must be a real directory")
	}
	return path, nil
}
