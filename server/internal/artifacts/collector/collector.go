// Package collector exports explicitly selected regular files from an already
// quiesced, independently retained volume. It runs only in a trusted process.
package collector

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
)

// Writer publishes immutable bytes under the exact domain-generated object key.
// The S3 writer and bounded test fixture implement this real storage seam.
type Writer interface {
	Put(context.Context, artifacts.Entry, io.Reader) error
}

// Collect never infers quiescence from the filesystem or a Pod status. The
// trusted runtime must persist and supply both compute and storage receipts.
// No manifest is returned if any selected file or upload fails verification.
func Collect(ctx context.Context, e artifacts.Export, root string, writer Writer, now time.Time) (artifacts.Manifest, error) {
	if e.Phase != artifacts.Collecting || e.Quiescence == nil || e.GC != nil || writer == nil {
		return artifacts.Manifest{}, artifacts.ErrNotReady
	}
	policy, err := e.Policy.Canonical()
	if err != nil {
		return artifacts.Manifest{}, err
	}
	if e.Source.Validate() != nil {
		return artifacts.Manifest{}, artifacts.ErrInvalid
	}
	digest, _ := artifacts.Digest(policy)
	if digest != e.PolicyDigest {
		return artifacts.Manifest{}, artifacts.ErrConflict
	}
	entries := []artifacts.Entry{}
	missing := []string{}
	var total int64
	for _, path := range policy.Paths {
		if err = ctx.Err(); err != nil {
			return artifacts.Manifest{}, err
		}
		entry, absent, err := collectFile(ctx, root, path, e, policy, policy.MaxTotalBytes-total, writer)
		if err != nil {
			return artifacts.Manifest{}, err
		}
		if absent {
			missing = append(missing, path)
			continue
		}
		entries = append(entries, entry)
		total += entry.Bytes
	}
	return artifacts.NewManifest(e.Source, policy, e.ID, entries, missing, now)
}

func collectFile(ctx context.Context, root, path string, e artifacts.Export, policy artifacts.Policy, remaining int64, writer Writer) (artifacts.Entry, bool, error) {
	file, identity, err := openRegular(root, path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) && policy.AllowMissing {
			return artifacts.Entry{}, true, nil
		}
		return artifacts.Entry{}, false, err
	}
	defer file.Close()
	limit := min(policy.MaxFileBytes, remaining)
	if identity.size > limit {
		return artifacts.Entry{}, false, artifacts.ErrInvalid
	}
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(contextReader{ctx, file}, limit+1))
	if err != nil {
		return artifacts.Entry{}, false, err
	}
	if n > limit || n != identity.size || !unchanged(file, identity) {
		return artifacts.Entry{}, false, artifacts.ErrConflict
	}
	entry := artifacts.Entry{ID: artifacts.EntryID(path), Path: path, Bytes: n, SHA256: "sha256:" + hex.EncodeToString(hash.Sum(nil))}
	entry.ObjectKey = artifacts.ObjectKey(e.Source, e.ID, path, entry.SHA256)
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return artifacts.Entry{}, false, err
	}
	// Hash the bytes passed to storage too. A late mutation never yields a
	// publishable manifest, even if an uncommitted object was already uploaded.
	hash.Reset()
	counter := &countReader{Reader: io.TeeReader(io.LimitReader(contextReader{ctx, file}, n+1), hash)}
	if err = writer.Put(ctx, entry, counter); err != nil {
		return artifacts.Entry{}, false, err
	}
	if counter.n != n || "sha256:"+hex.EncodeToString(hash.Sum(nil)) != entry.SHA256 || !unchanged(file, identity) {
		return artifacts.Entry{}, false, artifacts.ErrConflict
	}
	return entry, false, nil
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}

type countReader struct {
	io.Reader
	n int64
}

func (r *countReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	r.n += int64(n)
	return n, err
}
