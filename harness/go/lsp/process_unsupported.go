//go:build !linux && !darwin

package lsp

import "os/exec"

func processSupported() bool     { return false }
func configureProcess(*exec.Cmd) {}
func killProcess(*exec.Cmd)      {}
func cleanupProcess(*exec.Cmd)   {}
