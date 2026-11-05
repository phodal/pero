package fstools

import (
	"context"
	"errors"
	"io"
	"os"
)

const MaxMediaBytes = 128 << 20

// ReadBytes reads a regular workspace file as opaque bytes up to limit. It uses
// the same path and symlink policy as text reads and does not require UTF-8.
func (w *Workspace) ReadBytes(ctx context.Context, name string, limit int64) ([]byte, error) {
	if limit <= 0 || limit > MaxMediaBytes {
		return nil, errors.New("media read limit must be between 1 byte and 128 MiB")
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	name, err := w.checked(name, false)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	info, err := w.root.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("target must be regular file")
	}
	if info.Size() > limit {
		return nil, errors.New("file is too large to read as media; resize or export a smaller copy")
	}
	file, err := w.root.Open(name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("file is too large to read as media; resize or export a smaller copy")
	}
	current, err := w.root.Lstat(name)
	if err != nil || !os.SameFile(info, current) || info.Size() != current.Size() {
		return nil, errors.New("file changed while reading")
	}
	if err := w.check(); err != nil {
		return nil, err
	}
	return data, ctx.Err()
}
