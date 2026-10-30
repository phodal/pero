//go:build unix

package remoteacp

import (
	"os/exec"
	"syscall"
)

func isolateChild(command *exec.Cmd) (func(), error) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	return func() {
		if command.Process != nil {
			_ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
		}
	}, nil
}
