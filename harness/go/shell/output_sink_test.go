package shell

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
	"time"
)

func TestForegroundSinkCapturesBothStreamsBeyondTailLimits(t *testing.T) {
	var output bytes.Buffer
	executor := testExecutor(t, LocalOptions{MaxOutputBytes: 128, OutputSink: &output})
	result, err := runCommand(t, executor, t.Context(), `for ((i=0;i<5000;i++)); do printf O; printf E >&2; done`)
	if err != nil || output.Len() != 10000 || bytes.Count(output.Bytes(), []byte("O")) != 5000 || bytes.Count(output.Bytes(), []byte("E")) != 5000 {
		t.Fatalf("full capture lost output: bytes=%d result=%+v error=%v", output.Len(), result, err)
	}
	if !result.Stdout.Truncated || !result.Stderr.Truncated || len(result.Stdout.Text) != 128 || len(result.Stderr.Text) != 128 {
		t.Fatalf("trusted sink changed bounded collectors: %+v", result)
	}
}

type failingOutputSink struct {
	err error
}

func (s failingOutputSink) Write([]byte) (int, error) { return 0, s.err }

func TestForegroundSinkFailureCancelsOwnedExecution(t *testing.T) {
	failure := errors.New("fixture capture unavailable")
	for _, test := range []struct {
		name string
		sink failingOutputSink
		want error
	}{
		{"write error", failingOutputSink{failure}, failure},
		{"short write", failingOutputSink{}, io.ErrShortWrite},
	} {
		t.Run(test.name, func(t *testing.T) {
			executor := testExecutor(t, LocalOptions{OutputSink: test.sink})
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
			defer cancel()
			result, err := runCommand(t, executor, ctx, `printf ready; sleep 30`)
			if !errors.Is(err, test.want) || !result.Aborted || result.TimedOut || ctx.Err() != nil {
				t.Fatalf("capture failure did not stop the executor: %+v %v", result, err)
			}
		})
	}
}
