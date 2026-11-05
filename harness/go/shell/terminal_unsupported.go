//go:build !linux && !darwin

package shell

import (
	"errors"
	"os"
	"os/exec"
)

func terminalSupported() bool            { return false }
func configureTerminalProcess(*exec.Cmd) {}
func openTerminal(int, int) (*os.File, *os.File, error) {
	return nil, nil, errors.New("shell: PTY unsupported on this platform")
}
func resizeTerminal(*os.File, int, int) error {
	return errors.New("shell: PTY unsupported on this platform")
}
