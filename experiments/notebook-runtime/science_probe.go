// Standalone probe of the existing Science Kernel; never an alternative owner.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/phodal/pero/harness/go/scienceenv"
)

func main() {
	if err := probe(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func probe() error {
	if len(os.Args) != 4 {
		return fmt.Errorf("usage: science_probe PYTHON WORKSPACE CELLS_JSON")
	}
	workspace, err := filepath.Abs(os.Args[2])
	if err != nil {
		return err
	}
	data, err := os.ReadFile(os.Args[3])
	if err != nil {
		return err
	}
	var cells []string
	if err := json.Unmarshal(data, &cells); err != nil {
		return err
	}
	started := time.Now()
	kernel, err := scienceenv.Start(scienceenv.Config{Language: scienceenv.Python, Interpreter: os.Args[1], Workspace: workspace})
	if err != nil {
		return err
	}
	defer kernel.Close()
	ctx, stop := context.WithTimeout(context.Background(), 30*time.Second)
	defer stop()
	first, err := kernel.Exec(ctx, "print('READY')", scienceenv.Host{})
	if err != nil || first.Error != "" {
		return fmt.Errorf("readiness: %v %s", err, first.Error)
	}
	ready := time.Since(started).Seconds()
	var final scienceenv.Output
	started = time.Now()
	for _, cell := range cells {
		final, err = kernel.Exec(ctx, cell, scienceenv.Host{})
		if err != nil || final.Error != "" {
			return fmt.Errorf("cell: %v %s", err, final.Error)
		}
	}
	compute := time.Since(started).Seconds()
	before, err := os.ReadFile(filepath.Join(workspace, "result.json"))
	if err != nil {
		return err
	}
	// Reusing the fixture workspace must not mistake an earlier run's marker for readiness.
	if err := os.Remove(filepath.Join(workspace, "cell-ready")); err != nil && !os.IsNotExist(err) {
		return err
	}
	running, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := kernel.Exec(running, "sentinel=42\nfrom pathlib import Path\nimport signal\nPath('cell-ready').write_text('started')\nwhile True: signal.pause()", scienceenv.Host{})
		done <- err
	}()
	// Poll an actual external-process file effect, never hope the goroutine started.
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
waitReady:
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-done:
			return fmt.Errorf("cell ended before ready: %v", err)
		case <-ticker.C:
			if _, err := os.Stat(filepath.Join(workspace, "cell-ready")); err == nil {
				break waitReady
			}
		}
	}
	started = time.Now()
	cancel()
	select {
	case err := <-done:
		if err == nil {
			return fmt.Errorf("cancelled kernel reported success")
		}
	case <-ctx.Done():
		return ctx.Err()
	}
	cancelled := time.Since(started).Seconds()
	started = time.Now()
	recovered, err := kernel.Exec(ctx, "print('sentinel' in globals())", scienceenv.Host{})
	if err != nil || recovered.Stdout != "False\n" {
		return fmt.Errorf("fresh-state recovery: %v %+v", err, recovered)
	}
	recovery := time.Since(started).Seconds()
	for _, cell := range cells {
		final, err = kernel.Exec(ctx, cell, scienceenv.Host{})
		if err != nil || final.Error != "" {
			return fmt.Errorf("recovery cell: %v %s", err, final.Error)
		}
	}
	after, err := os.ReadFile(filepath.Join(workspace, "result.json"))
	if err != nil {
		return err
	}
	if string(before) != string(after) {
		return fmt.Errorf("recovery changed deterministic output")
	}
	return json.NewEncoder(os.Stdout).Encode(struct {
		Ready, Compute, Cancel, Recovery float64
		Reset                            bool
		Output                           string
	}{ready, compute, cancelled, recovery, true, string(after)})
}
