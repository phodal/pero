package nativetools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
)

type sessionWorkingDirectoryKey struct{}

// WithSessionWorkingDirectory anchors a native Bash invocation to its agent's
// session workspace instead of the user's persistent shell directory. This is
// trusted host composition, never a model argument. The invocation cannot
// change the persistent directory used by subsequent ordinary Bash calls.
func WithSessionWorkingDirectory(ctx context.Context) context.Context {
	return context.WithValue(ctx, sessionWorkingDirectoryKey{}, true)
}

func commandWithDirectoryMarker(shellPath, command, outputFile string) (string, string) {
	base := strings.ToLower(filepath.Base(shellPath))
	if outputFile == "" || command == "" || (base != "bash" && base != "sh") {
		return command, ""
	}
	marker := outputFile + ".pwd"
	// Open the sidecar before the command can rename/replace the workspace.
	// Directory observation is best effort and must never alter command output
	// or its status, including when the command closes our descriptor.
	return "{\n" + command + "\n__pero_status=$?\n{ pwd -P >&9; } 2>/dev/null\nexit $__pero_status\n} 9> " + quoteShell(marker), marker
}

func quoteShell(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}

func (s *shellTasks) observeShellDirectory(task *shellTask, old string) {
	if s == nil || task == nil || task.pwdMarker == "" || task.parent == nil {
		return
	}
	// A replaced pathname no longer identifies the original sidecar or cwd.
	if err := task.executor.CheckCWD(task.parent.Session().WorkingDirectory()); err != nil {
		return
	}
	data, err := os.ReadFile(task.pwdMarker)
	_ = os.Remove(task.pwdMarker)
	if err != nil {
		return
	}
	next := strings.TrimSpace(string(data))
	oldResolved, err := filepath.EvalSymlinks(old)
	if err != nil || oldResolved == "" {
		oldResolved = old
	}
	nextResolved, err := filepath.EvalSymlinks(next)
	if err != nil || nextResolved == "" || nextResolved == oldResolved {
		return
	}
	workspace, err := filepath.EvalSymlinks(s.options.CWD)
	if err != nil || workspace == "" {
		workspace = s.options.CWD
	}
	rel, err := filepath.Rel(workspace, nextResolved)
	outside := err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator))
	if outside && !isolatedWorkdir(nextResolved) {
		return
	}
	s.mu.Lock()
	s.shellCWD[task.parent.ID()] = nextResolved
	s.mu.Unlock()
	if s.onDirectory != nil {
		s.onDirectory(task.parent, oldResolved, nextResolved)
	}
}
