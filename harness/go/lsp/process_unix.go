//go:build linux || darwin

package lsp

import (
	"os/exec"
	"syscall"
)

func processSupported() bool             { return true }
func configureProcess(command *exec.Cmd) { command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }
func killProcess(command *exec.Cmd) {
	if command.Process != nil {
		_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	}
}
func cleanupProcess(command *exec.Cmd) { killProcess(command) }
