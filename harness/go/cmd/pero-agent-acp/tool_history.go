package main

import (
	"context"
	"errors"
	"flag"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

type toolHistoryFlags struct{ Total, Low, Recent int }

func bindToolHistory(flags *flag.FlagSet) *toolHistoryFlags {
	o := &toolHistoryFlags{}
	flags.IntVar(&o.Total, "tool-history-chars", 0, "tool text history high watermark; 0 disables clearing; requires workspace for original-output readback")
	flags.IntVar(&o.Low, "tool-history-low-watermark", 0, "clear old tool text to this character count; 0 chooses half the high watermark")
	flags.IntVar(&o.Recent, "tool-history-keep-recent", 4, "protect this many recent successful tool results; errors are always protected")
	return o
}

func (o toolHistoryFlags) config(workspace string) (*harness.ToolResultPruneConfig, error) {
	if o.Total < 0 || o.Low < 0 || o.Recent < 0 || o.Recent > 1024 || o.Total > 1<<30 {
		return nil, errors.New("invalid tool history limits")
	}
	if o.Total == 0 {
		if o.Low != 0 {
			return nil, errors.New("tool history low watermark requires a positive high watermark")
		}
		return nil, nil
	}
	if workspace == "" {
		return nil, errors.New("tool history clearing requires --workspace for original-output readback")
	}
	if o.Low == 0 {
		o.Low = o.Total / 2
	}
	c := &harness.ToolResultPruneConfig{TotalChars: &o.Total, LowWatermarkChars: &o.Low, KeepRecent: &o.Recent}
	_, err := harness.NewToolResultPruner(*c)
	return c, err
}

// One root policy applies equally to print, ACP, restored sessions and children.
func mountToolHistory(ctx context.Context, h *harness.Harness, c *harness.ToolResultPruneConfig) error {
	if c == nil {
		return nil
	}
	definition := point.Define(point.Descriptor{ID: "cli/tool-history"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		dispose, err := h.ToolResultPrunerPolicy().Override(*c, true)
		if err != nil {
			return nil, err
		}
		if err := run.Defer("tool-history-policy", dispose); err != nil {
			_ = dispose(context.Background())
			return nil, err
		}
		_, err = h.Hooks().Published.On(run, func(_ context.Context, agent *harness.Agent) error {
			_, err := agent.Session().Append("tool-history/config", h.ToolResultPrunerPolicy().Snapshot())
			return err
		})
		return nil, err
	})
	instance, err := h.Runtime().Mount(nil, "cli-tool-history", definition, nil)
	if err != nil {
		return err
	}
	if err = instance.WaitStable(ctx); err != nil {
		return err
	}
	if instance.Snapshot().State == point.Failed {
		return errors.New("tool history policy activation failed")
	}
	return nil
}
