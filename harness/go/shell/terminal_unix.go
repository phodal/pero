//go:build linux || darwin

package shell

import (
	"errors"
	"fmt"
	"golang.org/x/sys/unix"
	"os"
	"os/exec"
	"syscall"
)

func terminalSupported() bool { return true }
func configureTerminalProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true, Ctty: 0}
}
func resizeTerminal(master *os.File, rows, columns int) error {
	if rows < 1 || rows > 1000 || columns < 1 || columns > 1000 {
		return errors.New("shell: terminal dimensions must be between 1 and 1000")
	}
	return unix.IoctlSetWinsize(int(master.Fd()), unix.TIOCSWINSZ, &unix.Winsize{Row: uint16(rows), Col: uint16(columns)})
}
func openTerminal(rows, columns int) (master, slave *os.File, err error) {
	fd, err := unix.Open("/dev/ptmx", unix.O_RDWR|unix.O_CLOEXEC|unix.O_NOCTTY|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, nil, err
	}
	master = os.NewFile(uintptr(fd), "pty-master")
	defer func() {
		if err != nil {
			master.Close()
			if slave != nil {
				slave.Close()
			}
			master = nil
			slave = nil
		}
	}()
	name, err := terminalSlaveName(fd)
	if err != nil {
		return master, nil, err
	}
	slaveFD, err := unix.Open(name, unix.O_RDWR|unix.O_CLOEXEC|unix.O_NOCTTY, 0)
	if err != nil {
		return master, nil, err
	}
	slave = os.NewFile(uintptr(slaveFD), name)
	if err = resizeTerminal(master, rows, columns); err != nil {
		return master, slave, fmt.Errorf("resize: %w", err)
	}
	return master, slave, nil
}
