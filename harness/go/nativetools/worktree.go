package nativetools

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

// A root worktree is retained workspace data. Unlike a temporary child
// worktree, neither exit nor runtime disposal removes files or Git registration.
type rootWorktreeLease struct {
	Version  int                `json:"version"`
	Original string             `json:"original"`
	Path     string             `json:"path"`
	Commit   string             `json:"commit"`
	CallID   harness.ToolCallID `json:"call_id,omitempty"`
	Active   bool               `json:"active"`
}

type rootWorktreeTransition struct {
	CWD   string             `json:"cwd"`
	Lease *rootWorktreeLease `json:"root_worktree,omitempty"`
}

type rootWorktreeReceipt struct {
	State    string `json:"state"`
	CWD      string `json:"cwd"`
	Worktree string `json:"worktree"`
	Original string `json:"original"`
	Retained bool   `json:"retained"`
	Notice   string `json:"notice"`
}

func readRootWorktree(events []harness.Event) (*rootWorktreeLease, error) {
	var current *rootWorktreeLease
	for _, event := range events {
		if event.Type != "working-directory/change" {
			continue
		}
		var transition rootWorktreeTransition
		if err := json.Unmarshal(event.Data, &transition); err != nil {
			continue
		}
		if transition.Lease == nil {
			continue
		}
		lease := transition.Lease
		if lease.Version != 1 || !filepath.IsAbs(lease.Original) || !filepath.IsAbs(lease.Path) || !pathWithin(filepath.Join(lease.Original, ".pero", "worktrees"), lease.Path) || lease.Path == filepath.Join(lease.Original, ".pero", "worktrees") {
			return nil, errors.New("invalid durable root worktree lease")
		}
		expected := lease.Original
		if lease.Active {
			expected = lease.Path
		}
		if transition.CWD != expected {
			return nil, errors.New("root worktree lease does not match its working directory")
		}
		current = lease
	}
	return current, nil
}

// RootWorktreeWorkspace admits a root's typed active lease or an existing
// child's retained lease. Generic additional-directory bindings do not qualify.
func RootWorktreeWorkspace(agent *harness.Agent, original string) (*fstools.Workspace, error) {
	if agent == nil {
		return nil, errors.New("root worktree requires an agent")
	}
	owner := agent
	for owner.Parent() != nil {
		owner = owner.Parent()
	}
	lease, err := readRootWorktree(owner.Session().Events())
	if err != nil {
		return nil, err
	}
	if owner != agent && (lease == nil || lease.Path != agent.Session().WorkingDirectory()) {
		for _, event := range owner.Session().Events() {
			if event.Type != "working-directory/change" {
				continue
			}
			var transition rootWorktreeTransition
			if json.Unmarshal(event.Data, &transition) == nil && transition.Lease != nil && transition.Lease.Path == agent.Session().WorkingDirectory() {
				lease = transition.Lease
			}
		}
	}
	if lease == nil || owner == agent && !lease.Active || lease.Original != original || agent.Session().WorkingDirectory() != lease.Path {
		return nil, errors.New("session cwd is not an active worktree of the configured workspace")
	}
	value, ok := boundWorkspaces.Load(lease.Path)
	if !ok {
		return nil, errors.New("root worktree descriptor is unavailable; resume the original session")
	}
	files := value.(*fstools.Workspace)
	return files, files.CheckCWD(lease.Path)
}

type rootWorktrees struct {
	app   *App
	mu    sync.Mutex
	paths map[string]bool
}

func mountRootWorktreeTools(ctx context.Context, h *harness.Harness, app *App, options Options) error {
	// Git and CWD changes must not escape a configured shell sandbox. Root
	// worktree support is exposed only by the unsandboxed native composition.
	if options.Sandbox != nil {
		return nil
	}
	owner := &rootWorktrees{app: app, paths: make(map[string]bool)}
	definition := point.Define(point.Descriptor{ID: "native/root-worktree"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		if _, err := h.Tools().RestrictWhen(run, func(agent *harness.Agent, name string) bool {
			return name != "EnterWorktree" && name != "ExitWorktree" || agent.Parent() == nil && !agent.Delegated()
		}); err != nil {
			return nil, err
		}
		if _, err := h.Hooks().Activated.On(run, func(ctx context.Context, agent *harness.Agent) error {
			if agent.Parent() != nil || agent.Delegated() {
				return nil
			}
			return owner.restore(ctx, agent)
		}); err != nil {
			return nil, err
		}
		if err := run.Defer("retained-root-worktrees", func(context.Context) error {
			owner.mu.Lock()
			defer owner.mu.Unlock()
			for path := range owner.paths {
				ReleaseIsolatedWorkspace(path)
			}
			owner.paths = make(map[string]bool)
			return nil
		}); err != nil {
			return nil, err
		}
		for _, exit := range []bool{false, true} {
			name, description, schema := "EnterWorktree", "Create a retained detached Git worktree and switch this root session's execution directory. Requires approval and a workspace at the Git repository root. Starts at committed HEAD (or an explicit ref); existing uncommitted edits stay in the original checkout. Optional name labels a generated path under .pero/worktrees. Exit and runtime shutdown preserve all files and Git registration. No nested root worktree entry; no automatic branch or merge.", `{"type":"object","additionalProperties":false,"properties":{"name":{"type":"string","maxLength":48,"pattern":"^[A-Za-z0-9][A-Za-z0-9_-]*$"},"ref":{"type":"string","minLength":1,"maxLength":256}}}`
			if exit {
				name, description, schema = "ExitWorktree", "Return this root session to its original workspace. Requires approval. Always retain the worktree, including uncommitted edits and Git registration; no deletion, reset, commit or merge is performed. Existing background work keeps its own directory.", `{"type":"object","additionalProperties":false}`
			}
			_, err := h.Tools().Register(run, harness.Tool{Schema: harness.ToolSchema{Name: name, Description: description, InputSchema: json.RawMessage(schema)}, RequiresApproval: true, ExecutionMode: harness.ExecutionSerial, ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
				if request.Agent == nil || request.Agent.Parent() != nil || request.Agent.Delegated() {
					return harness.ToolResult{}, errors.New("worktree transitions require a root session")
				}
				owner.mu.Lock()
				defer owner.mu.Unlock()
				if exit {
					return owner.exit(ctx, request.Agent)
				}
				var input struct {
					Name string `json:"name"`
					Ref  string `json:"ref"`
				}
				if err := json.Unmarshal(request.Arguments, &input); err != nil {
					return harness.ToolResult{}, err
				}
				return owner.enter(ctx, request, input.Name, input.Ref)
			}})
			if err != nil {
				return nil, err
			}
		}
		return nil, nil
	})
	instance, err := h.Runtime().Mount(nil, "native/root-worktree", definition, nil)
	if err == nil {
		err = instance.WaitStable(ctx)
	}
	return err
}

func (owner *rootWorktrees) bind(path string) (string, error) {
	if owner.paths[path] {
		return path, nil
	}
	canonical, err := BindIsolatedWorkspace(path)
	if err == nil {
		owner.paths[canonical] = true
	}
	return canonical, err
}

func (owner *rootWorktrees) restore(ctx context.Context, agent *harness.Agent) error {
	lease, err := readRootWorktree(agent.Session().Events())
	if err != nil || lease == nil || !lease.Active {
		return err
	}
	if lease.Original != owner.app.files.Path() || agent.Session().WorkingDirectory() != lease.Path {
		return errors.New("root worktree resume does not match the selected original workspace")
	}
	if err := verifyRootWorktree(ctx, *lease); err != nil {
		return fmt.Errorf("retained worktree is unavailable; no Git operation was replayed: %w", err)
	}
	owner.mu.Lock()
	defer owner.mu.Unlock()
	_, err = owner.bind(lease.Path)
	return err
}

func (owner *rootWorktrees) enter(ctx context.Context, request harness.ToolRequest, name, ref string) (harness.ToolResult, error) {
	agent := request.Agent
	previous, err := readRootWorktree(agent.Session().Events())
	if err != nil {
		return harness.ToolResult{}, err
	}
	if previous != nil && previous.Active {
		return renderResult(rootWorktreeReceipt{State: "active", CWD: agent.Session().WorkingDirectory(), Worktree: previous.Path, Original: previous.Original, Retained: true, Notice: "Already in a retained root worktree; exit before entering another. No Git operation was replayed."}, nil)
	}
	original := owner.app.files.Path()
	if err := owner.app.files.CheckCWD(agent.Session().WorkingDirectory()); err != nil {
		return harness.ToolResult{}, err
	}
	top, err := rootGitLine(ctx, original, "rev-parse", "--show-toplevel")
	if err != nil {
		return harness.ToolResult{}, fmt.Errorf("worktree requires a Git checkout: %w", err)
	}
	// Git prints slash-separated filesystem paths even on Windows. Normalize
	// only path-valued results, never refs, commit IDs or arbitrary Git output.
	if filepath.Clean(top) != original {
		return harness.ToolResult{}, errors.New("EnterWorktree requires the configured workspace to be the repository root")
	}
	if ref == "" {
		ref = "HEAD"
	}
	commit, err := rootGitLine(ctx, original, "rev-parse", "--verify", "--end-of-options", ref+"^{commit}")
	if err != nil {
		return harness.ToolResult{}, fmt.Errorf("invalid committed worktree ref: %w", err)
	}
	if name == "" {
		name = "session"
	}
	relative := filepath.Join(".pero", "worktrees", name+"-"+rand.Text())
	root, err := os.OpenRoot(original)
	if err != nil {
		return harness.ToolResult{}, err
	}
	err = root.MkdirAll(filepath.Dir(relative), 0700)
	root.Close()
	if err != nil {
		return harness.ToolResult{}, err
	}
	path := filepath.Join(original, relative)
	receipt := rootWorktreeReceipt{State: "unknown", CWD: original, Worktree: path, Original: original, Retained: true, Notice: "Inspect this retained path before retrying. The tool never deletes partial worktree effects."}
	if _, err := rootGitLine(ctx, original, "worktree", "add", "--detach", path, commit); err != nil {
		return renderResult(receipt, err)
	}
	path, err = owner.bind(path)
	if err != nil {
		return renderResult(receipt, err)
	}
	lease := rootWorktreeLease{Version: 1, Original: original, Path: path, Commit: commit, CallID: request.CallID, Active: true}
	if err := owner.transition(ctx, agent, lease); err != nil {
		return renderResult(receipt, err)
	}
	receipt.State, receipt.CWD, receipt.Worktree, receipt.Notice = "active", path, path, "Worktree retained. Changes to the original checkout were not copied, discarded or merged."
	return renderResult(receipt, nil)
}

func (owner *rootWorktrees) exit(ctx context.Context, agent *harness.Agent) (harness.ToolResult, error) {
	lease, err := readRootWorktree(agent.Session().Events())
	if err != nil {
		return harness.ToolResult{}, err
	}
	if lease == nil || !lease.Active {
		return harness.ToolResult{}, errors.New("this session has no active root worktree")
	}
	if lease.Original != owner.app.files.Path() {
		return harness.ToolResult{}, errors.New("worktree return point does not match configured workspace")
	}
	if err := owner.app.files.CheckCWD(lease.Original); err != nil {
		return harness.ToolResult{}, err
	}
	lease.Active = false
	receipt := rootWorktreeReceipt{State: "unknown", CWD: agent.Session().WorkingDirectory(), Worktree: lease.Path, Original: lease.Original, Retained: true, Notice: "Worktree files and Git registration are preserved."}
	if err := owner.transition(ctx, agent, *lease); err != nil {
		return renderResult(receipt, err)
	}
	receipt.State, receipt.CWD = "retained", lease.Original
	return renderResult(receipt, nil)
}

func (owner *rootWorktrees) transition(ctx context.Context, agent *harness.Agent, lease rootWorktreeLease) error {
	cwd := lease.Original
	if lease.Active {
		cwd = lease.Path
	}
	if _, err := agent.Session().Append("working-directory/change", rootWorktreeTransition{CWD: cwd, Lease: &lease}); err != nil {
		return err
	}
	if owner.app.background != nil {
		owner.app.background.mu.Lock()
		delete(owner.app.background.shellCWD, agent.ID())
		owner.app.background.mu.Unlock()
	}
	return agent.Session().Flush(ctx)
}

func verifyRootWorktree(ctx context.Context, lease rootWorktreeLease) error {
	original, err := rootGitLine(ctx, lease.Original, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return err
	}
	current, err := rootGitLine(ctx, lease.Path, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return err
	}
	if filepath.Clean(original) != filepath.Clean(current) {
		return errors.New("worktree belongs to a different Git repository")
	}
	listing, err := rootGitLine(ctx, lease.Original, "worktree", "list", "--porcelain", "-z")
	if err != nil {
		return err
	}
	for _, field := range strings.Split(listing, "\x00") {
		if path, ok := strings.CutPrefix(field, "worktree "); ok && filepath.Clean(path) == lease.Path {
			return nil
		}
	}
	return errors.New("retained worktree is no longer registered")
}

func rootGitLine(ctx context.Context, dir string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "git", append([]string{"-c", "core.hooksPath=/dev/null", "-C", dir}, args...)...)
	for _, entry := range os.Environ() {
		name, _, _ := strings.Cut(entry, "=")
		if !strings.HasPrefix(name, "GIT_") {
			command.Env = append(command.Env, entry)
		}
	}
	command.WaitDelay = 250 * time.Millisecond
	configureNativeProcess(command)
	defer cleanupNativeProcess(command)
	output := &nativeProcessOutput{limit: 1 << 20, cancel: cancel}
	command.Stdout, command.Stderr = output, output
	err := command.Run()
	if err != nil {
		return "", fmt.Errorf("git %s: %w: %s", args[0], err, boundedText(output.buffer.String(), 2048))
	}
	return strings.TrimSpace(output.buffer.String()), nil
}
