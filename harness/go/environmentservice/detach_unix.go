//go:build darwin || linux

package environmentservice

import (
	"os/exec"
	"syscall"
)

func detach(command *exec.Cmd) error {
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	return nil
}
