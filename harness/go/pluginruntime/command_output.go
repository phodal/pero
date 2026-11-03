package pluginruntime

import (
	"crypto/rand"
	"fmt"
	"github.com/phodal/pero/harness/go/shell"
)

const skillCommandInlineBytes = 64 << 10

var ErrSkillCommandOutputLimit = shell.ErrOutputFileLimit

// skillCommandOutput owns skill rendering policy; shell.FileCapture owns the
// shared private-file authority and bounded process-output storage.
type skillCommandOutput struct {
	capture shell.FileCapture
	path    string
	spilled bool
}

func (w *skillCommandOutput) open(workspace string) error {
	plan, err := shell.PlanOutputFile(workspace, ".pero/plugin-output", "skill-"+rand.Text()+".txt", 0)
	if err != nil {
		return err
	}
	if err := w.capture.Open(plan); err != nil {
		return err
	}
	w.path = plan.Path()
	return nil
}

func (w *skillCommandOutput) Write(source []byte) (int, error) { return w.capture.Write(source) }

func (w *skillCommandOutput) projection(success bool, readback int) (string, error) {
	characters, err := w.capture.ReadRunes(shell.ClaudeOutputReadLimit(shell.ClaudeInlineChars, readback))
	if err != nil {
		return "", err
	}
	projected := shell.ProjectClaudeCommandOutput(characters, shell.ClaudeInlineChars, readback, success)
	if !success || !projected.Artifact {
		return projected.Text, nil
	}
	size, truncated, err := w.capture.Trim(shell.ClaudeArtifactBytes)
	if err != nil {
		return "", err
	}
	w.spilled = true
	return fmt.Sprintf("output_file: %s\noutput_file_bytes: %d\noutput_file_truncated: %t\n%s", w.path, size, truncated, projected.Text), nil
}

func (w *skillCommandOutput) close(keep bool) error { return w.capture.Close(keep) }
