package pluginruntime

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	skillCommandInlineBytes  = 64 << 10
	skillCommandOutputBytes  = 64 << 20
	skillCommandPreviewBytes = 2048
)

var ErrSkillCommandOutputLimit = errors.New("plugin-runtime: skill command output exceeded the 64 MiB capture limit; incomplete output discarded")

// skillCommandOutput owns one foreground capture. It is opened only after the
// command's permission record has flushed, and kept only for successful output
// that cannot fit inline. LocalExecutor serializes writes from both streams.
type skillCommandOutput struct {
	root    *os.Root
	file    *os.File
	name    string
	path    string
	bytes   int64
	spilled bool
}

func (w *skillCommandOutput) open(workspace string) error {
	root, err := os.OpenRoot(workspace)
	if err != nil {
		return fmt.Errorf("plugin-runtime: open skill output workspace: %w", err)
	}
	defer root.Close()
	for _, directory := range []string{".pero", filepath.Join(".pero", "plugin-output")} {
		if err := root.Mkdir(directory, 0700); err != nil && !errors.Is(err, os.ErrExist) {
			return fmt.Errorf("plugin-runtime: create skill output directory: %w", err)
		}
		info, err := root.Lstat(directory)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("plugin-runtime: skill output parents must be directories without symlinks")
		}
		if directory != ".pero" && info.Mode().Perm()&0077 != 0 {
			return errors.New("plugin-runtime: skill output directory must have private permissions (0700)")
		}
	}
	outputRoot, err := root.OpenRoot(filepath.Join(".pero", "plugin-output"))
	if err != nil {
		return fmt.Errorf("plugin-runtime: open skill output directory: %w", err)
	}
	name := "skill-" + rand.Text() + ".txt"
	file, err := outputRoot.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		outputRoot.Close()
		return fmt.Errorf("plugin-runtime: create skill output: %w", err)
	}
	w.root, w.file, w.name = outputRoot, file, name
	w.path = filepath.Join(workspace, ".pero", "plugin-output", name)
	return nil
}

func (w *skillCommandOutput) Write(source []byte) (int, error) {
	if w.file == nil {
		return 0, errors.New("plugin-runtime: skill output capture is not open")
	}
	if int64(len(source)) > skillCommandOutputBytes-w.bytes {
		return 0, ErrSkillCommandOutputLimit
	}
	n, err := w.file.Write(source)
	w.bytes += int64(n)
	return n, err
}

func (w *skillCommandOutput) projection(success bool) (string, error) {
	if success && w.bytes <= skillCommandInlineBytes {
		data := make([]byte, int(w.bytes))
		_, err := w.file.ReadAt(data, 0)
		return string(data), err
	}
	previewSize := min(int64(skillCommandPreviewBytes), w.bytes)
	head, tail := make([]byte, previewSize), make([]byte, previewSize)
	if _, err := w.file.ReadAt(head, 0); err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	if _, err := w.file.ReadAt(tail, w.bytes-previewSize); err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	// Preview boundaries may split UTF-8 sequences; the saved file stays exact.
	text := strings.ToValidUTF8(string(head), "�")
	if w.bytes > previewSize {
		text += "\n...\n" + strings.ToValidUTF8(string(tail), "�")
	}
	if !success {
		return text, nil
	}
	if err := w.file.Sync(); err != nil {
		return "", fmt.Errorf("plugin-runtime: persist skill command output: %w", err)
	}
	w.spilled = true
	return fmt.Sprintf("Output saved to: %s\nTotal bytes: %d\nFirst and last %d bytes:\n%s", w.path, w.bytes, skillCommandPreviewBytes, text), nil
}

func (w *skillCommandOutput) close(keep bool) error {
	var err error
	if w.file != nil {
		err = w.file.Close()
		w.file = nil
	}
	if w.root != nil {
		if !keep {
			err = errors.Join(err, w.root.Remove(w.name))
		}
		err = errors.Join(err, w.root.Close())
		w.root = nil
	}
	return err
}
