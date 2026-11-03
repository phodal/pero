package fstools

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
)

const MaxPatchFiles = 32

type patchHunk struct {
	before, after []string
	anchor        string
	end           bool
}

type filePatch struct {
	path, move, kind, added string
	hunks                   []patchHunk
}

type patchEffect struct {
	path, kind, before, after, digest string
}

type PatchFileReceipt struct {
	Operation string `json:"operation"`
	ScopedTextReceipt
}

type PatchReceipt struct {
	Files    []PatchFileReceipt `json:"files"`
	Complete bool               `json:"complete"`
}

// parsePatch accepts the explicit Begin/End Patch format, not a shell command
// or fuzzy diff. Each file appears once; moves must target a new path.
func parsePatch(text string) ([]filePatch, error) {
	if len(text) > MaxFileBytes || !validText([]byte(text)) {
		return nil, errors.New("patch must be UTF-8 text of at most 1 MiB without NUL")
	}
	lines := strings.Split(strings.TrimSuffix(text, "\n"), "\n")
	if len(lines) < 3 || lines[0] != "*** Begin Patch" || lines[len(lines)-1] != "*** End Patch" {
		return nil, errors.New("patch requires *** Begin Patch and *** End Patch lines")
	}
	var files []filePatch
	for i := 1; i < len(lines)-1; {
		var file filePatch
		for _, kind := range []string{"Add", "Update", "Delete"} {
			if name, ok := strings.CutPrefix(lines[i], "*** "+kind+" File: "); ok {
				file.path, file.kind = name, kind
				break
			}
		}
		if file.path == "" {
			return nil, fmt.Errorf("expected file header at line %d", i+1)
		}
		i++
		if file.kind == "Update" && i < len(lines)-1 && strings.HasPrefix(lines[i], "*** Move to: ") {
			file.move = strings.TrimPrefix(lines[i], "*** Move to: ")
			i++
		}
		for i < len(lines)-1 && !strings.HasPrefix(lines[i], "*** ") {
			if file.kind == "Delete" {
				return nil, errors.New("delete headers do not accept content")
			}
			if file.kind == "Add" {
				if !strings.HasPrefix(lines[i], "+") {
					return nil, errors.New("added file lines must start with +")
				}
				file.added += lines[i][1:] + "\n"
				i++
				continue
			}
			if lines[i] != "@@" && !strings.HasPrefix(lines[i], "@@ ") {
				return nil, errors.New("update hunks require @@ or @@ exact anchor line")
			}
			hunk := patchHunk{anchor: strings.TrimPrefix(lines[i], "@@")}
			hunk.anchor = strings.TrimPrefix(hunk.anchor, " ")
			i++
			for i < len(lines)-1 && !strings.HasPrefix(lines[i], "@@") && !strings.HasPrefix(lines[i], "*** ") {
				line := lines[i]
				if len(line) == 0 || !strings.ContainsRune(" +-", rune(line[0])) {
					return nil, fmt.Errorf("invalid hunk line %d", i+1)
				}
				if line[0] != '+' {
					hunk.before = append(hunk.before, line[1:])
				}
				if line[0] != '-' {
					hunk.after = append(hunk.after, line[1:])
				}
				i++
			}
			if i < len(lines)-1 && lines[i] == "*** End of File" {
				hunk.end = true
				i++
			}
			if len(hunk.before) == 0 && len(hunk.after) == 0 {
				return nil, errors.New("empty patch hunk")
			}
			file.hunks = append(file.hunks, hunk)
		}
		if file.kind == "Update" && len(file.hunks) == 0 && file.move == "" {
			return nil, errors.New("update requires hunks or a move destination")
		}
		files = append(files, file)
		if len(files) > MaxPatchFiles {
			return nil, errors.New("patch exceeds 32 files")
		}
	}
	return files, nil
}

func patchText(before string, hunks []patchHunk) (string, error) {
	newline := strings.HasSuffix(before, "\n")
	lines := strings.Split(strings.TrimSuffix(before, "\n"), "\n")
	if before == "" {
		lines = nil
	}
	cursor := 0
	for _, hunk := range hunks {
		if hunk.anchor != "" {
			found := -1
			for i := cursor; i < len(lines); i++ {
				if lines[i] == hunk.anchor {
					if found >= 0 {
						return "", errors.New("patch anchor is ambiguous")
					}
					found = i
				}
			}
			if found < 0 {
				return "", errors.New("patch anchor not found")
			}
			cursor = found + 1
		}
		found := -1
		if len(hunk.before) == 0 {
			found = cursor
			if hunk.end {
				found = len(lines)
			}
		} else {
			for i := cursor; i+len(hunk.before) <= len(lines); i++ {
				if hunk.end && i+len(hunk.before) != len(lines) {
					continue
				}
				matched := true
				for j, line := range hunk.before {
					if lines[i+j] != line {
						matched = false
						break
					}
				}
				if matched {
					if found >= 0 {
						return "", errors.New("patch context is ambiguous; include more context")
					}
					found = i
				}
			}
		}
		if found < 0 {
			return "", errors.New("patch context does not match current file")
		}
		next := append([]string(nil), lines[:found]...)
		next = append(next, hunk.after...)
		lines = append(next, lines[found+len(hunk.before):]...)
		cursor = found + len(hunk.after)
		if len(strings.Join(lines, "\n")) > MaxFileBytes {
			return "", errors.New("patched content exceeds 1 MiB")
		}
	}
	after := strings.Join(lines, "\n")
	if len(lines) > 0 && newline {
		after += "\n"
	}
	return after, nil
}

// ApplyPatch preflights every file before the first write. Commits are ordered,
// not a cross-file transaction. Receipts retain every completed/uncertain effect
// and the unattempted tail; callers must reconcile before retrying a failed patch.
// Approval and durable tool-call intent belong to the existing tool registry.
func (w *Workspace) ApplyPatch(ctx context.Context, text string) (PatchReceipt, error) {
	receipt := PatchReceipt{Files: []PatchFileReceipt{}}
	if !w.SupportsReplacement() {
		return receipt, errors.New("patch replacement is unavailable on this platform")
	}
	files, err := parsePatch(text)
	if err != nil {
		return receipt, err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	var effects []patchEffect
	seen := map[string]bool{}
	for _, file := range files {
		for _, name := range []string{file.path, file.move} {
			if name == "" {
				continue
			}
			if len(name) > 512 {
				return receipt, errors.New("patch paths must be at most 512 bytes so all effect receipts fit the output budget")
			}
			if seen[name] {
				return receipt, fmt.Errorf("duplicate patch path %q", name)
			}
			seen[name] = true
			if _, err := w.checked(name, false); err != nil {
				return receipt, err
			}
		}
		if err := ctx.Err(); err != nil {
			return receipt, err
		}
		if file.kind == "Add" {
			if _, err := w.root.Lstat(file.path); !errors.Is(err, os.ErrNotExist) {
				return receipt, fmt.Errorf("add target must not exist: %s", file.path)
			}
			effects = append(effects, patchEffect{path: file.path, kind: "add", after: file.added})
			continue
		}
		selected, err := w.selectFile(file.path)
		if err != nil {
			return receipt, err
		}
		before, err := selected.Read(ctx, file.path)
		selected.Close()
		if err != nil {
			return receipt, err
		}
		if file.kind == "Delete" {
			effects = append(effects, patchEffect{path: file.path, kind: "delete", before: before.Text, digest: before.Digest})
			continue
		}
		after, err := patchText(before.Text, file.hunks)
		if err != nil {
			return receipt, fmt.Errorf("%s: %w", file.path, err)
		}
		if len(after) > MaxFileBytes {
			return receipt, errors.New("patched content exceeds 1 MiB")
		}
		if file.move != "" {
			if _, err := w.root.Lstat(file.move); !errors.Is(err, os.ErrNotExist) {
				return receipt, fmt.Errorf("move destination must not exist: %s", file.move)
			}
			effects = append(effects, patchEffect{path: file.move, kind: "add", after: after}, patchEffect{path: file.path, kind: "delete", before: before.Text, digest: before.Digest})
		} else {
			effects = append(effects, patchEffect{path: file.path, kind: "update", before: before.Text, after: after, digest: before.Digest})
		}
	}
	for _, effect := range effects {
		receipt.Files = append(receipt.Files, PatchFileReceipt{Operation: effect.kind, ScopedTextReceipt: ScopedTextReceipt{Path: effect.path, BeforeDigest: effect.digest, State: "not-applied"}})
	}
	for i, effect := range effects {
		if err := ctx.Err(); err != nil {
			return receipt, err
		}
		var state ScopedTextReceipt
		if effect.kind == "add" {
			if _, err = w.checked(effect.path, false); err == nil {
				state, err = w.writeNew(ctx, effect.path, effect.after)
			}
		} else {
			state, err = w.applyExistingPatch(ctx, effect)
		}
		if state.Path != "" {
			receipt.Files[i].ScopedTextReceipt = state
		}
		if err != nil {
			return receipt, err
		}
	}
	receipt.Complete = true
	return receipt, nil
}

func (w *Workspace) applyExistingPatch(ctx context.Context, effect patchEffect) (ScopedTextReceipt, error) {
	receipt := ScopedTextReceipt{Path: effect.path, BeforeDigest: effect.digest, State: "not-applied"}
	if _, err := w.checked(effect.path, false); err != nil {
		return receipt, err
	}
	selected, err := w.selectFile(effect.path)
	if err != nil {
		return receipt, err
	}
	defer selected.Close()
	if effect.kind == "update" {
		if effect.before == effect.after {
			receipt.State, receipt.AfterDigest = "unchanged", effect.digest
			return receipt, nil
		}
		return selected.Replace(ctx, effect.path, effect.digest, []byte(effect.after), func(ctx context.Context) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			return w.check()
		})
	}
	selected.mu.Lock()
	defer selected.mu.Unlock()
	before, _, err := selected.readLocked(ctx, effect.path)
	if err != nil {
		return receipt, err
	}
	if before.Digest != effect.digest {
		return receipt, errors.New("delete preimage changed")
	}
	target := selected.files[effect.path]
	if err := selected.check(target); err != nil {
		return receipt, err
	}
	if err := w.check(); err != nil {
		return receipt, err
	}
	if err := ctx.Err(); err != nil {
		return receipt, err
	}
	receipt.State = "unknown"
	if err := target.parent.Remove(target.name); err != nil {
		return receipt, err
	}
	dir, err := target.parent.Open(".")
	if err != nil {
		return receipt, err
	}
	if err := errors.Join(dir.Sync(), dir.Close()); err != nil {
		return receipt, err
	}
	if _, err := target.parent.Lstat(target.name); !errors.Is(err, os.ErrNotExist) {
		return receipt, errors.New("deleted path was replaced; reconcile before retrying")
	}
	receipt.State = "applied"
	return receipt, nil
}
