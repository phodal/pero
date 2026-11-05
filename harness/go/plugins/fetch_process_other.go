//go:build !linux && !darwin

package plugins

import "os/exec"

func configureGitProcess(command *exec.Cmd) {}
