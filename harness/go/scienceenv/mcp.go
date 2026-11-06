package scienceenv

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

// BioServers is every stdio server under a bio-tools root: each lib/<name>/server.py
// launched by run_server.py. python and the launcher must be absolute. This does not start them.
func BioServers(python, serversRoot, workspace string) ([]harness.MCPServerConfig, error) {
	python, err := resolveInterpreter(python)
	if err != nil {
		return nil, fmt.Errorf("science mcp python: %w", err)
	}
	python, err = filepath.Abs(python)
	if err != nil {
		return nil, err
	}
	root, err := filepath.Abs(serversRoot)
	if err != nil {
		return nil, err
	}
	launcher := filepath.Join(root, "run_server.py")
	info, err := os.Stat(launcher)
	if err != nil || info.IsDir() {
		return nil, errors.New("science mcp root must contain run_server.py")
	}
	workspace, err = filepath.Abs(workspace)
	if err != nil {
		return nil, err
	}
	lib := filepath.Join(root, "lib")
	entries, err := os.ReadDir(lib)
	if err != nil {
		return nil, fmt.Errorf("science mcp lib: %w", err)
	}
	var names []string
	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || !strings.HasPrefix(name, "mcp_") {
			continue
		}
		serverFile := filepath.Join(lib, name, "server.py")
		serverInfo, err := os.Lstat(serverFile)
		if err != nil {
			continue
		}
		if serverInfo.Mode()&os.ModeSymlink != 0 || !serverInfo.Mode().IsRegular() {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	if len(names) == 0 {
		return nil, errors.New("science mcp root has no servers")
	}
	servers := make([]harness.MCPServerConfig, 0, len(names))
	for _, name := range names {
		servers = append(servers, harness.MCPServerConfig{
			Name: name, Transport: harness.MCPStdio, Command: python,
			Args: []string{launcher, name}, CWD: workspace, FailOnStartupError: true,
		})
	}
	return servers, nil
}

// LiteratureServers is the previous pubmed and literature pair. BioServers is the full set.
func LiteratureServers(python, serversRoot, workspace string) ([]harness.MCPServerConfig, error) {
	return BioServers(python, serversRoot, workspace)
}

func (e *Env) mountLiteratureMCP(ctx context.Context, h *harness.Harness, python, root string) ([]string, error) {
	if h == nil || h.Runtime() == nil || h.Prompts() == nil {
		return nil, errors.New("science mcp requires a running harness")
	}
	servers, err := BioServers(python, root, e.workspace)
	if err != nil {
		return nil, err
	}
	definition := point.Define(
		point.Descriptor{ID: "scienceenv/mcp", Requires: []point.Requirement{point.Require(harness.ToolRegistryKey)}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			registry, err := point.Resolve(run, harness.ToolRegistryKey)
			if err != nil {
				return nil, err
			}
			startup, cancel := context.WithTimeout(run.Context, 3*time.Minute)
			defer cancel()
			if err := harness.MountMCPServers(startup, run, registry, h.Prompts(), servers); err != nil {
				return nil, err
			}
			return func(context.Context) error { return nil }, nil
		},
	)
	instance, err := h.Runtime().Mount(nil, "scienceenv/literature-mcp", definition, nil)
	if err != nil {
		return nil, err
	}
	if err := instance.WaitStable(ctx); err != nil {
		_ = instance.Dispose(context.Background())
		return nil, err
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		_ = instance.Dispose(context.Background())
		return nil, fmt.Errorf("science mcp: %s", snapshot.LastError)
	}
	names := make([]string, len(servers))
	for i := range servers {
		names[i] = servers[i].Name
	}
	return names, nil
}
