//go:build linux || darwin

package workflow

import (
	"os/exec"
	"syscall"
)

func workflowProcessSupported() bool { return true }

func configureWorkflowProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.Cancel = func() error { return syscall.Kill(-command.Process.Pid, syscall.SIGKILL) }
}

func cleanupWorkflowProcess(command *exec.Cmd) {
	if command.Process != nil {
		_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
	}
}
