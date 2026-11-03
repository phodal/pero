package nativetools

import (
	"os"
	"path/filepath"
	"strings"
)

func commandWithDirectoryMarker(shellPath, command, outputFile string) (string, string) {
	base := strings.ToLower(filepath.Base(shellPath))
	if outputFile == "" || command == "" || (base != "bash" && base != "sh") {
		return command, ""
	}
	marker := outputFile + ".pwd"
	return command + "\n__pero_status=$?\npwd -P > " + quoteShell(marker) + "\nexit $__pero_status", marker
}

func quoteShell(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}

func (s *shellTasks) observeShellDirectory(task *shellTask, old string) {
	if s == nil || task == nil || task.pwdMarker == "" || task.parent == nil {
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
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return
	}
	s.mu.Lock()
	s.shellCWD[task.parent.ID()] = nextResolved
	s.mu.Unlock()
	if s.onDirectory != nil {
		s.onDirectory(task.parent, oldResolved, nextResolved)
	}
}
