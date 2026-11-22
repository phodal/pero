//go:build linux || darwin

package shell

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"time"
)

func platformSupported() bool            { return true }
func configureProcess(command *exec.Cmd) { command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }

type processGroup int

func (group processGroup) kill() {
	if group > 1 {
		_ = syscall.Kill(-int(group), syscall.SIGKILL)
	}
}

func (group processGroup) terminate(grace time.Duration) {
	if group <= 1 {
		return
	}
	_ = syscall.Kill(-int(group), syscall.SIGTERM)
	// Do not stop when the group leader exits: descendants may ignore TERM.
	timer := time.NewTimer(grace)
	defer timer.Stop()
	<-timer.C
	group.kill()
}

// The private broker has one process/start. The stdio protocol reports a
// logical ID, so verify the OS group through the broker's direct child.
func execServerProcessGroup(brokerPID int) processGroup {
	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	command := exec.CommandContext(ctx, "/bin/ps", "-ax", "-o", "pid=", "-o", "ppid=", "-o", "pgid=")
	command.Env = []string{"LC_ALL=C"}
	rows, err := command.Output()
	if err != nil {
		return 0
	}
	owner := []byte(strconv.Itoa(brokerPID))
	var group processGroup
	for _, row := range bytes.Split(rows, []byte{'\n'}) {
		fields := bytes.Fields(row)
		if len(fields) != 3 || !bytes.Equal(fields[1], owner) || !bytes.Equal(fields[0], fields[2]) {
			continue
		}
		pid, err := strconv.Atoi(string(fields[0]))
		if err != nil || pid <= 1 || group != 0 {
			return 0
		}
		group = processGroup(pid)
	}
	return group
}

func processSignal(state *os.ProcessState) string {
	if state == nil {
		return ""
	}
	status, ok := state.Sys().(syscall.WaitStatus)
	if !ok || !status.Signaled() {
		return ""
	}
	return status.Signal().String()
}
