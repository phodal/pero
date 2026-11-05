//go:build !linux && !darwin

package nativetools

import "os/exec"

func configureNativeProcess(*exec.Cmd) {}
func cleanupNativeProcess(*exec.Cmd)   {}
