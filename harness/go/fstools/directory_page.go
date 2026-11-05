package fstools

import (
	"context"
	"errors"
	"io"
	"sort"
)

// DirectoryPage sorts each bounded page by name. Offset continues the raw live
// enumeration, not the sorted positions; directory mutations require a restart.
type DirectoryPage struct {
	Entries    []DirectoryEntry
	NextOffset int
}

func (w *Workspace) ListPage(ctx context.Context, name string, offset int) (DirectoryPage, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if offset < 0 {
		return DirectoryPage{}, errors.New("directory offset must be non-negative")
	}
	name, err := w.checked(name, true)
	if err != nil {
		return DirectoryPage{}, err
	}
	dir, err := openScopedTextFile(w.root, name)
	if err != nil {
		return DirectoryPage{}, err
	}
	defer dir.Close()
	for skipped := 0; skipped < offset; {
		if err := ctx.Err(); err != nil {
			return DirectoryPage{}, err
		}
		entries, err := dir.ReadDir(min(MaxEntries, offset-skipped))
		skipped += len(entries)
		if errors.Is(err, io.EOF) {
			return DirectoryPage{Entries: []DirectoryEntry{}}, nil
		}
		if err != nil {
			return DirectoryPage{}, err
		}
	}
	if err := ctx.Err(); err != nil {
		return DirectoryPage{}, err
	}
	entries, err := dir.ReadDir(MaxEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return DirectoryPage{}, err
	}
	page := DirectoryPage{Entries: []DirectoryEntry{}}
	if len(entries) > MaxEntries {
		entries = entries[:MaxEntries]
		page.NextOffset = offset + MaxEntries
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		link, err := scopedEntryLink(entry)
		if err != nil {
			return DirectoryPage{}, err
		}
		page.Entries = append(page.Entries, DirectoryEntry{entry.Name(), entry.IsDir(), link})
	}
	return page, ctx.Err()
}
