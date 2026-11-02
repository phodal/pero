//go:build !linux && !darwin

package workflow

import "os/exec"

func workflowProcessSupported() bool     { return false }
func configureWorkflowProcess(*exec.Cmd) {}
func cleanupWorkflowProcess(*exec.Cmd)   {}
