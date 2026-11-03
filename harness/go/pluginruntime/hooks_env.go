package pluginruntime

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/phodal/pero/harness/go/claudehooks"
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

func (app *HookApp) envFilePath(agent *harness.Agent) (string, error) {
	if app == nil || agent == nil || agent.Session() == nil {
		return "", nil
	}
	cwd := agent.Session().WorkingDirectory()
	if !filepath.IsAbs(cwd) {
		return "", nil
	}
	directory := filepath.Join(cwd, ".pero", "claude-env")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(directory, envFileName(string(agent.ID())))
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := os.WriteFile(path, nil, 0o600); err != nil {
			return "", err
		}
	}
	return path, nil
}

func envFileName(session string) string {
	var name strings.Builder
	for _, char := range session {
		if char <= unicode.MaxASCII && (unicode.IsLetter(char) || unicode.IsDigit(char) || char == '-' || char == '_') {
			name.WriteRune(char)
			continue
		}
		name.WriteByte('_')
	}
	if name.Len() == 0 {
		return "session"
	}
	return name.String()
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
	app.mu.Lock()
	if app.dynamicWatches == nil {
		app.dynamicWatches = map[*harness.Agent][]string{}
	}
	app.dynamicWatches[agent] = append([]string(nil), decision.WatchPaths...)
	app.mu.Unlock()
}
