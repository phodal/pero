package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync/atomic"
)

// The caller creates the private file. Never create or replace it here: if it
// disappears or cannot be synced, no subsequent provider request may start.
func httpAttemptAudit(path string, limit int) (func() error, error) {
	if path == "" {
		return nil, nil
	}
	if !filepath.IsAbs(path) || limit < 0 {
		return nil, errors.New("HTTP attempt audit requires an absolute path and nonnegative request cap")
	}
	var attempts atomic.Int64
	return func() error {
		// Recording attempts is independent of limiting them. Zero preserves the
		// provider's default uncapped request policy while retaining durable audit.
		if count := attempts.Add(1); limit > 0 && count > int64(limit) {
			return errors.New("HTTP attempt cap exhausted")
		}
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() {
			return errors.New("HTTP attempt audit is unavailable")
		}
		file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0)
		if err != nil {
			return err
		}
		defer file.Close()
		n, err := file.WriteString("attempt\n")
		if err != nil {
			return err
		}
		if n != len("attempt\n") {
			return io.ErrShortWrite
		}
		return file.Sync()
	}, nil
}
