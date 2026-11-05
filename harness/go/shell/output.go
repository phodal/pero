package shell

import (
	"context"
	"fmt"
	"io"
	"sync"
)

// foregroundOutputSink serializes the two pipe readers. A failed capture must
// cancel the owned process group, while its pipes continue draining until exit.
type foregroundOutputSink struct {
	mu     sync.Mutex
	writer io.Writer
	cancel context.CancelCauseFunc
	failed bool
}

func (w *foregroundOutputSink) Write(source []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.failed {
		n, err := w.writer.Write(source)
		if err == nil && n != len(source) {
			err = io.ErrShortWrite
		}
		if err != nil {
			w.failed = true
			w.cancel(fmt.Errorf("shell: output sink: %w", err))
		}
	}
	return len(source), nil
}

// tailWriter retains the source collector's bounded trailing-byte algorithm.
// Its memory use stays bounded even when a trusted foreground sink is present.
type tailWriter struct {
	mu        sync.Mutex
	limit     int
	data      []byte
	truncated bool
}

func newTailWriter(limit int) *tailWriter {
	return &tailWriter{limit: limit, data: make([]byte, 0, limit)}
}
func (w *tailWriter) Write(source []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(source) > w.limit {
		w.data = append(w.data[:0], source[len(source)-w.limit:]...)
		w.truncated = true
		return len(source), nil
	}
	overflow := len(w.data) + len(source) - w.limit
	if overflow > 0 {
		copy(w.data, w.data[overflow:])
		w.data = w.data[:len(w.data)-overflow]
		w.truncated = true
	}
	w.data = append(w.data, source...)
	return len(source), nil
}
func (w *tailWriter) Output() CollectedOutput {
	w.mu.Lock()
	defer w.mu.Unlock()
	return CollectedOutput{Text: string(append([]byte(nil), w.data...)), Truncated: w.truncated}
}
