//go:build darwin

package shell

import (
	"bytes"
	"fmt"
	"golang.org/x/sys/unix"
	"syscall"
	"unsafe"
)

func terminalSlaveName(fd int) (string, error) {
	for _, operation := range []uint{unix.TIOCPTYGRANT, unix.TIOCPTYUNLK} {
		if err := unix.IoctlSetInt(fd, operation, 0); err != nil {
			return "", fmt.Errorf("grant/unlock %x: %w", operation, err)
		}
	}
	var name [128]byte
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), unix.TIOCPTYGNAME, uintptr(unsafe.Pointer(&name[0])))
	if errno != 0 {
		return "", fmt.Errorf("slave name: %w", errno)
	}
	return string(bytes.TrimRight(name[:], "\x00")), nil
}
