package subagents

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/phodal/pero/harness/go/nativetools"
)

func isolateGitWorktree(workspace string) (dir string, cleanup func(), err error) {
	toplevel, err := gitLine(workspace, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", nil, fmt.Errorf("subagents: worktree isolation requires a Git checkout: %w", err)
	}
	dir, err = os.MkdirTemp("", "pero-agent-worktree-")
	if err != nil {
		return "", nil, err
	}
	if err := os.Remove(dir); err != nil {
		return "", nil, err
	}
	if output, err := gitCommand(toplevel, "worktree", "add", "--detach", dir).CombinedOutput(); err != nil {
		return "", nil, fmt.Errorf("subagents: create detached worktree: %w: %s", err, strings.TrimSpace(string(output)))
	}
	bound, err := nativetools.BindIsolatedWorkspace(dir)
	if err != nil {
		_ = gitCommand(toplevel, "worktree", "remove", "--force", dir).Run()
		return "", nil, err
	}
	cleanup = func() {
		nativetools.ReleaseIsolatedWorkspace(bound)
		_ = gitCommand(toplevel, "worktree", "remove", "--force", dir).Run()
		_ = gitCommand(toplevel, "worktree", "remove", "--force", bound).Run()
		_ = os.RemoveAll(dir)
		if bound != dir {
			_ = os.RemoveAll(bound)
		}
	}
	return bound, cleanup, nil
}

func gitCommand(dir string, args ...string) *exec.Cmd {
	command := exec.Command("git", append([]string{"-C", dir}, args...)...)
	command.Env = gitEnv()
	return command
}

func gitEnv() []string {
	env := make([]string, 0, len(os.Environ()))
	for _, entry := range os.Environ() {
		name, _, _ := strings.Cut(entry, "=")
		if strings.HasPrefix(name, "GIT_") {
			continue
		}
		env = append(env, entry)
	}
	return env
}

func gitLine(dir string, args ...string) (string, error) {
	output, err := gitCommand(dir, args...).Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}
