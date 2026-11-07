package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// Research's allowance belongs to the approved program, across ACP restarts.
// Host owns this file and ensures only the program's original run can use it.
func researchAttemptAudit(path string, limit int) (func() error, error) {
	if !filepath.IsAbs(path) || limit < 1 {
		return nil, errors.New("research requires an absolute attempt audit and positive cap")
	}
	read := func() (int, error) {
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() {
			return 0, errors.New("research attempt audit is unavailable")
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return 0, err
		}
		count := bytes.Count(data, []byte("attempt\n"))
		if len(data) != count*len("attempt\n") {
			return 0, errors.New("research attempt audit is corrupt")
		}
		return count, nil
	}
	if _, err := read(); err != nil {
		return nil, err
	}
	appendAttempt, err := httpAttemptAudit(path, 0)
	if err != nil {
		return nil, err
	}
	var mu sync.Mutex
	return func() error {
		mu.Lock()
		defer mu.Unlock()
		count, err := read()
		if err != nil {
			return err
		}
		if count >= limit {
			return errors.New("research cumulative model request budget exhausted")
		}
		return appendAttempt()
	}, nil
}
