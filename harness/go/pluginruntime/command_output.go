package pluginruntime

import (
	"crypto/rand"
	"fmt"
	"github.com/phodal/pero/harness/go/shell"
)

const (
	skillCommandInlineBytes  = 64 << 10
	skillCommandPreviewBytes = 2048
)

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

func (w *skillCommandOutput) projection(success bool) (string, error) {
	limit := 0
	if success {
		limit = skillCommandInlineBytes
	}
	output, err := w.capture.Preview(limit, skillCommandPreviewBytes)
	if err != nil {
		return "", err
	}
	if !success || !output.Truncated {
		return output.Text, nil
	}
	w.spilled = true
	return fmt.Sprintf("Output saved to: %s\nTotal bytes: %d\nFirst and last %d bytes:\n%s", w.path, output.Bytes, skillCommandPreviewBytes, output.Text), nil
}

func (w *skillCommandOutput) close(keep bool) error { return w.capture.Close(keep) }
