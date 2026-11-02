// Package shell provides bounded foreground shell execution, not an OS sandbox.
package shell

import (
	"context"
	"time"

	"github.com/phodal/pero/harness/go/sandbox"
)

type CollectedOutput struct {
	Text      string `json:"text"`
	Truncated bool   `json:"truncated"`
}

type ExpiryPolicy string

const (
	ExpiryKill ExpiryPolicy = "kill"
	ExpiryNone ExpiryPolicy = "none"
)

type ExecRequest struct {
	Command        string
	Workdir        string
	Timeout        time.Duration
	StdoutMaxBytes int
	OnExpiry       ExpiryPolicy
}

type ExecSpec struct {
	Command        string
	Workdir        string
	Timeout        time.Duration
	StdoutMaxBytes int
	OnExpiry       ExpiryPolicy
}

type RunResult struct {
	Enforcement       sandbox.Enforcement `json:"enforcement,omitempty"`
	ReadIsolated      bool                `json:"readIsolated"`
	NetworkIsolated   bool                `json:"networkIsolated"`
	CleanupUncertain  bool                `json:"cleanupUncertain,omitempty"`
	ExitCode          *int                `json:"exitCode"`
	Signal            string              `json:"signal,omitempty"`
	TimedOut          bool                `json:"timedOut"`
	Aborted           bool                `json:"aborted"`
	Timeout           time.Duration       `json:"-"`
	Stdout            CollectedOutput     `json:"stdout"`
	Stderr            CollectedOutput     `json:"stderr"`
	OutputFile        string              `json:"output_file,omitempty"`
	OutputBytes       int64               `json:"output_bytes,omitempty"`
	OutputFilePartial bool                `json:"output_file_partial,omitempty"`
}

type Executor interface {
	Resolve(ExecRequest) (ExecSpec, error)
	Run(context.Context, ExecSpec) (RunResult, error)
}
