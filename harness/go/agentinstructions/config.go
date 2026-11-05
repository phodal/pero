package agentinstructions

import "github.com/phodal/pero/harness/go/fstools"

const DefaultMaxBytes = 65_536

// Options is trusted host composition, never model input. Discovery is exactly
// Workspace/AGENTS.md by default. Hierarchical opts into scoped discovery.
type Options struct {
	Workspace string
	// Hierarchical loads workspace-contained CLAUDE.md and AGENTS.md at root
	// and along paths touched by file tools. It never reads above Workspace.
	Hierarchical bool
	// MaxBytes is the rendered context budget; zero selects DefaultMaxBytes.
	MaxBytes int
}

type App struct {
	files          *fstools.Workspace
	maxBytes       int
	hierarchical   bool
	workspaceAlias string
}

// Close follows Harness Dispose/Drain, so no instruction read is in flight.
func (a *App) Close() error {
	if a == nil {
		return nil
	}
	return a.files.Close()
}
func (a *App) CheckCWD(cwd string) error { return a.files.CheckCWD(cwd) }
