package pluginruntime

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
)

const fileWatchInterval = 100 * time.Millisecond

type fileStamp struct {
	exists bool
	mod    time.Time
	size   int64
}

// ensureFileWatch starts one poller for this agent's working directory. The
// matcher lists literal filenames. Changes from tools, shell commands, and
// other processes are all visible. The hook cannot block the write.
func (app *HookApp) ensureFileWatch(agent *harness.Agent) {
	if app == nil || agent == nil || !app.hasHookEvent("FileChanged") {
		return
	}
	app.mu.Lock()
	if app.closed || app.fileWatchCancels[agent] != nil {
		app.mu.Unlock()
		return
	}
	parent := app.owner
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	if app.fileWatchCancels == nil {
		app.fileWatchCancels = map[*harness.Agent]context.CancelFunc{}
	}
	app.fileWatchCancels[agent] = cancel
	app.asyncCancels = append(app.asyncCancels, cancel)
	app.calls.Add(1)
	app.mu.Unlock()
	cwd := agent.Session().WorkingDirectory()
	stamps := map[string]fileStamp{}
	for _, path := range app.watchedFiles(agent, cwd) {
		stamps[path] = stampFile(path)
	}
	go app.pollFiles(ctx, agent, cwd, stamps)
}

func (app *HookApp) pollFiles(ctx context.Context, agent *harness.Agent, cwd string, stamps map[string]fileStamp) {
	defer app.calls.Done()
	ticker := time.NewTicker(fileWatchInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, path := range app.watchedFiles(agent, cwd) {
				next := stampFile(path)
				previous, seen := stamps[path]
				stamps[path] = next
				if !seen {
					continue
				}
				kind := ""
				switch {
				case !previous.exists && next.exists:
					kind = "add"
				case previous.exists && !next.exists:
					kind = "unlink"
				case previous.exists && next.exists && (previous.mod != next.mod || previous.size != next.size):
					kind = "change"
				}
				if kind == "" {
					continue
				}
				decision, err := app.event(ctx, agent, claudehooks.Input{Event: "FileChanged", FilePath: path, FileChange: kind})
				if err != nil || decision.WatchPaths == nil {
					continue
				}
				app.mu.Lock()
				if app.dynamicWatches == nil {
					app.dynamicWatches = map[*harness.Agent][]string{}
				}
				app.dynamicWatches[agent] = append([]string(nil), decision.WatchPaths...)
				app.mu.Unlock()
			}
		}
	}
}

func (app *HookApp) watchedFiles(agent *harness.Agent, cwd string) []string {
	seen := map[string]bool{}
	var paths []string
	add := func(path string) {
		if path == "" || seen[path] {
			return
		}
		seen[path] = true
		paths = append(paths, path)
	}
	for _, pkg := range app.packages {
		for _, hook := range pkg.Hooks {
			if hook.Event != "FileChanged" {
				continue
			}
			matcher := strings.TrimSpace(hook.Matcher)
			if matcher == "" || matcher == "*" {
				continue
			}
			for _, part := range strings.Split(matcher, "|") {
				part = strings.TrimSpace(part)
				if part == "" || part == "*" || filepath.IsAbs(part) || strings.Contains(part, "/") {
					continue
				}
				add(filepath.Join(cwd, part))
			}
		}
	}
	app.mu.Lock()
	dynamic := append([]string(nil), app.dynamicWatches[agent]...)
	app.mu.Unlock()
	for _, path := range dynamic {
		if filepath.IsAbs(path) {
			add(path)
		}
	}
	return paths
}

func stampFile(path string) fileStamp {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return fileStamp{}
	}
	return fileStamp{exists: true, mod: info.ModTime(), size: info.Size()}
}
