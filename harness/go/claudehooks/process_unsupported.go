//go:build !linux && !darwin

package claudehooks

import "os/exec"

func hookProcessSupported() bool     { return false }
func configureHookProcess(*exec.Cmd) {}
func cleanupHookProcess(*exec.Cmd)   {}
