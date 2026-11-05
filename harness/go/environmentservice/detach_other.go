//go:build !darwin && !linux

package environmentservice

import (
	"errors"
	"os/exec"
)

func detach(*exec.Cmd) error { return errors.New("environment-owned services currently require Unix") }
