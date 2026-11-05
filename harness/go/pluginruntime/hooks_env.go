package pluginruntime

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
)

func envHookEvent(event string) bool {
	switch event {
	case "SessionStart", "Setup", "FileChanged", "CwdChanged":
		return true
	default:
		return false
	}
}

func (app *HookApp) prepareEnvFile(agent *harness.Agent, event string) (string, error) {
	if !envHookEvent(event) {
		return "", nil
	}
	return app.envFilePath(agent)
}

type hookEnvironment struct {
	path    string
	release func()
}

func (app *HookApp) envFilePath(agent *harness.Agent) (string, error) {
	if app == nil || agent == nil || agent.Session() == nil {
		return "", nil
	}
	app.mu.Lock()
	defer app.mu.Unlock()
	if app.closed {
		return "", errors.New("plugin-runtime: hooks are closed")
	}
	if env := app.envFiles[agent]; env != nil {
		return env.path, nil
	}
	// Never reuse a workspace path or a session-ID-derived startup script.
	directory, err := os.MkdirTemp("", "pero-hook-env-")
	if err != nil {
		return "", err
	}
	canonical, err := filepath.EvalSymlinks(directory)
	if err != nil {
		_ = os.RemoveAll(directory)
		return "", err
	}
	workspace, err := filepath.EvalSymlinks(agent.Session().WorkingDirectory())
	if err != nil || pathWithin(workspace, canonical) {
		_ = os.RemoveAll(canonical)
		return "", errors.New("plugin-runtime: hook environment must be outside the workspace")
	}
	release := fstools.ProtectDirectory(canonical)
	path := filepath.Join(canonical, "environment")
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err == nil {
		err = file.Close()
	}
	if err != nil {
		_ = os.RemoveAll(canonical)
		release()
		return "", err
	}
	if app.envFiles == nil {
		app.envFiles = make(map[*harness.Agent]*hookEnvironment)
	}
	app.envFiles[agent] = &hookEnvironment{path: path, release: release}
	return path, nil
}

func (app *HookApp) cleanupEnvFile(agent *harness.Agent) {
	app.mu.Lock()
	defer app.mu.Unlock()
	if env := app.envFiles[agent]; env != nil {
		_ = os.RemoveAll(filepath.Dir(env.path))
		env.release()
		delete(app.envFiles, agent)
	}
}

func (app *HookApp) cleanupEnvFiles() {
	app.mu.Lock()
	defer app.mu.Unlock()
	for agent, env := range app.envFiles {
		_ = os.RemoveAll(filepath.Dir(env.path))
		env.release()
		delete(app.envFiles, agent)
	}
}

// BashEnvironmentFile is the session environment later Bash commands source.
func (app *HookApp) BashEnvironmentFile(agent *harness.Agent) string {
	path, err := app.envFilePath(agent)
	if err != nil || path == "" {
		return ""
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		return ""
	}
	return path
}

// ShellDirectoryChanged runs CwdChanged after Bash leaves a new directory.
// The previous session environment is cleared first.
func (app *HookApp) ShellDirectoryChanged(agent *harness.Agent, old, next string) {
	if app == nil || agent == nil || old == "" || next == "" || old == next {
		return
	}
	if path, err := app.envFilePath(agent); err == nil && path != "" {
		_ = os.WriteFile(path, nil, 0o600)
	}
	decision, err := app.event(context.Background(), agent, claudehooks.Input{Event: "CwdChanged", OldCWD: old, NewCWD: next})
	if err != nil || decision.WatchPaths == nil {
		return
	}
	app.setDynamicWatches(agent, decision.WatchPaths)
}
