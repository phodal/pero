package nativetools

import (
	"bytes"
	"context"
	"errors"
)

type nativeProcessOutput struct {
	buffer bytes.Buffer
	limit  int
	cancel context.CancelFunc
}

var errNativeProcessOutputLimit = errors.New("process output exceeds byte budget")

func (b *nativeProcessOutput) Write(data []byte) (int, error) {
	if len(data) > b.limit-b.buffer.Len() {
		b.cancel()
		return 0, errNativeProcessOutputLimit
	}
	return b.buffer.Write(data)
}
