//go:build !linux && !darwin

package shell

import (
	"os"
	"os/exec"
	"time"
)

func platformSupported() bool    { return false }
func configureProcess(*exec.Cmd) {}

type processGroup int

func (processGroup) kill()                    {}
func (processGroup) terminate(time.Duration)  {}
func execServerProcessGroup(int) processGroup { return 0 }
func processSignal(*os.ProcessState) string   { return "" }
