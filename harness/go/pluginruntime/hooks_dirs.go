package pluginruntime

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
)

var errDirectoryAlreadyAdded = errors.New("plugin-runtime: directory is already added")

func addDirectoryCommand(app *HookApp) harness.CommandDefinition {
	return harness.CommandDefinition{
		Name: "add-dir", Description: "Add a working directory",
		Handler: func(_ context.Context, invocation harness.CommandInvocation) (harness.CommandResult, error) {
			path := strings.TrimSpace(invocation.RawInput)
			if path == "" || strings.ContainsAny(path, "\r\n") || len(strings.Fields(path)) != 1 {
				return harness.CommandResult{Kind: harness.CommandError, Text: "Usage: /add-dir <path>"}, nil
			}
			added, err := app.AddDirectory(invocation.Agent, path)
			if err != nil {
				return harness.CommandResult{Kind: harness.CommandError, Text: err.Error()}, nil
			}
			return harness.CommandResult{Kind: harness.CommandSuccess, Text: "Added " + added}, nil
		},
	}
}

// AddDirectory grants a real directory outside the session workspace and then
// runs DirectoryAdded. The add itself does not wait for the hook.
func (app *HookApp) AddDirectory(agent *harness.Agent, raw string) (string, error) {
	bound, err := app.bindAddedDirectory(agent, raw)
	if err != nil {
		return "", err
	}
	app.noteDirectoryAdded(agent, bound)
	return bound, nil
}

// bindAddedDirectory grants the directory without DirectoryAdded. Permission
// updates use this path; only /add-dir and register_repo_root notify.
func (app *HookApp) bindAddedDirectory(agent *harness.Agent, raw string) (string, error) {
	if app == nil || agent == nil || agent.Session() == nil {
		return "", errors.New("plugin-runtime: add-dir requires an agent")
	}
	cleaned := filepath.Clean(strings.TrimSpace(raw))
	if !filepath.IsAbs(cleaned) {
		return "", errors.New("plugin-runtime: add-dir path must be absolute")
	}
	info, err := os.Lstat(cleaned)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("plugin-runtime: add-dir path must be a real directory")
	}
	canonical, err := filepath.EvalSymlinks(cleaned)
	if err != nil {
		return "", err
	}
	workspace, err := filepath.EvalSymlinks(agent.Session().WorkingDirectory())
	if err != nil {
		workspace = agent.Session().WorkingDirectory()
	}
	if pathWithin(workspace, canonical) || pathWithin(canonical, workspace) {
		return "", errors.New("plugin-runtime: directory is already part of the workspace")
	}
	app.mu.Lock()
	if app.addedDirs[agent][canonical] {
		app.mu.Unlock()
		return "", errDirectoryAlreadyAdded
	}
	app.mu.Unlock()
	bound, err := nativetools.BindIsolatedWorkspace(canonical)
	if err != nil {
		return "", err
	}
	app.mu.Lock()
	if app.addedDirs == nil {
		app.addedDirs = map[*harness.Agent]map[string]bool{}
	}
	if app.addedDirs[agent] == nil {
		app.addedDirs[agent] = map[string]bool{}
	}
	if app.addedDirs[agent][bound] {
		app.mu.Unlock()
		nativetools.ReleaseIsolatedWorkspace(bound)
		return "", errDirectoryAlreadyAdded
	}
	app.addedDirs[agent][bound] = true
	app.mu.Unlock()
	return bound, nil
}

func (app *HookApp) releaseAddedDirectory(agent *harness.Agent, raw string) error {
	if app == nil || agent == nil {
		return errors.New("plugin-runtime: add-dir requires an agent")
	}
	cleaned := filepath.Clean(strings.TrimSpace(raw))
	if !filepath.IsAbs(cleaned) {
		return errors.New("plugin-runtime: add-dir path must be absolute")
	}
	canonical := cleaned
	if resolved, err := filepath.EvalSymlinks(cleaned); err == nil {
		canonical = resolved
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	for path := range app.addedDirs[agent] {
		if path == canonical || path == cleaned {
			delete(app.addedDirs[agent], path)
			nativetools.ReleaseIsolatedWorkspace(path)
			return nil
		}
	}
	return nil
}

func (app *HookApp) noteDirectoryAdded(agent *harness.Agent, directory string) {
	parent := app.owner
	if parent == nil {
		parent = context.Background()
	}
	app.calls.Add(1)
	go func() {
		defer app.calls.Done()
		decision, err := app.event(context.WithoutCancel(parent), agent, claudehooks.Input{
			Event: "DirectoryAdded", Directory: directory, Source: "slash_command",
		})
		if err != nil || decision.SystemMessage == "" {
			return
		}
		_ = agent.Deliver(hookMessage("DirectoryAdded", decision.SystemMessage), false)
	}()
}

func (app *HookApp) releaseAddedDirectories() {
	app.mu.Lock()
	added := app.addedDirs
	app.addedDirs = nil
	app.mu.Unlock()
	for _, dirs := range added {
		for path := range dirs {
			nativetools.ReleaseIsolatedWorkspace(path)
		}
	}
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
