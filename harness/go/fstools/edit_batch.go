package fstools

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// TextEdit matches the original file. All ranges must be disjoint; validation
// completes before a single descriptor-bound replacement commits the file.
type TextEdit struct {
	OldText    string `json:"old_text"`
	NewText    string `json:"new_text"`
	ReplaceAll bool   `json:"replace_all,omitempty"`
}

func (w *Workspace) EditBatch(ctx context.Context, name string, edits []TextEdit) (ScopedTextReceipt, error) {
	if !w.SupportsReplacement() {
		return ScopedTextReceipt{}, errors.New("native Windows file replacement is unavailable")
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	name, err := w.checked(name, false)
	if err != nil {
		return ScopedTextReceipt{}, err
	}
	if len(edits) < 1 || len(edits) > 64 {
		return ScopedTextReceipt{}, errors.New("edit requires 1..64 replacements")
	}
	total := 0
	for _, edit := range edits {
		total += len(edit.OldText) + len(edit.NewText)
		if edit.OldText == "" || len(edit.OldText) > MaxFileBytes || len(edit.NewText) > MaxFileBytes || total > 2*MaxFileBytes || !validText([]byte(edit.OldText)) || !validText([]byte(edit.NewText)) {
			return ScopedTextReceipt{}, errors.New("edits require nonempty UTF-8 old_text and at most 2 MiB total replacement text")
		}
	}
	selected, err := w.selectFile(name)
	if err != nil {
		return ScopedTextReceipt{}, err
	}
	defer selected.Close()
	before, err := selected.Read(ctx, name)
	if err != nil {
		return ScopedTextReceipt{}, err
	}
	type replacement struct {
		start, end int
		text       string
	}
	var ranges []replacement
	size := int64(len(before.Text))
	matched := 0
	for i, edit := range edits {
		count := strings.Count(before.Text, edit.OldText)
		if count == 0 || !edit.ReplaceAll && count != 1 {
			return ScopedTextReceipt{}, fmt.Errorf("edit %d: old_text must match exactly once unless replace_all is true (found %d); reread the current file", i+1, count)
		}
		matched += count * len(edit.OldText)
		if matched > len(before.Text) {
			return ScopedTextReceipt{}, errors.New("edits overlap in the original file")
		}
		size += int64(count) * int64(len(edit.NewText)-len(edit.OldText))
		for offset := 0; offset < len(before.Text); {
			at := strings.Index(before.Text[offset:], edit.OldText)
			if at < 0 {
				break
			}
			at += offset
			ranges = append(ranges, replacement{at, at + len(edit.OldText), edit.NewText})
			offset = at + len(edit.OldText)
		}
	}
	if size > MaxFileBytes {
		return ScopedTextReceipt{}, errors.New("edited content exceeds 1 MiB")
	}
	sort.Slice(ranges, func(i, j int) bool { return ranges[i].start < ranges[j].start })
	var after strings.Builder
	end := 0
	for _, r := range ranges {
		if r.start < end {
			return ScopedTextReceipt{}, errors.New("edits overlap in the original file; merge nearby changes into one replacement")
		}
		after.WriteString(before.Text[end:r.start])
		after.WriteString(r.text)
		end = r.end
	}
	after.WriteString(before.Text[end:])
	return selected.Replace(ctx, name, before.Digest, []byte(after.String()), func(c context.Context) error {
		if err := c.Err(); err != nil {
			return err
		}
		return w.check()
	})
}
