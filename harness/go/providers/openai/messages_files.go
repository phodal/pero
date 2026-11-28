package openai

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/phodal/pero/harness/go/providers/messages"
)

const messagesFilesBeta = "files-api-2025-04-14"
const messagesFileRefreshMargin = time.Hour
const messagesFileLifetime = 7 * 24 * time.Hour
const messagesFilesDeadline = 20 * time.Second
const maxMessagesFileRecord = 4096
const maxMessagesFilesBackoff = 8

type messagesFiles struct {
	client    *http.Client
	url, root string
	reclaim   bool

	mu                                sync.Mutex
	uploads                           map[[32]byte]*messagesFileUpload
	backoffVersion                    uint64
	backoffInterval, backoffRemaining int
}

// beginUpload is called on cache misses only.
// Cached references never consume the cooldown; a skipped miss makes the
// existing all-inline fallback preserve the request without a Files attempt.
func (f *messagesFiles) beginUploadLocked() (uint64, bool) {
	if f.backoffRemaining > 0 {
		f.backoffRemaining--
		return 0, false
	}
	return f.backoffVersion, true
}

func (f *messagesFiles) finishUploadLocked(version uint64, timeout bool) {
	if version != f.backoffVersion {
		return // overlapping responses cannot double or clear a newer interval
	}
	f.backoffVersion++
	if timeout {
		f.backoffInterval = min(maxMessagesFilesBackoff, max(1, 2*f.backoffInterval))
		f.backoffRemaining = f.backoffInterval
	} else {
		f.backoffInterval, f.backoffRemaining = 0, 0
	}
}

type messagesFileRecord struct {
	ID       string    `json:"id"`
	Expires  time.Time `json:"expires"`
	Filename string    `json:"filename,omitempty"`
}

type messagesInlineRetry struct {
	ids     []string
	prepare func(context.Context) ([]byte, error)
}

func (a *Adapter) preferMessagesFiles(ctx context.Context, wire *messages.Request) []string {
	bounded, cancel := context.WithTimeout(ctx, messagesFilesDeadline)
	defer cancel()
	resolved := make(map[[32]byte]string)
	used := wire.PreferFiles(func(src messages.ImageSource) (string, error) {
		if err := bounded.Err(); err != nil {
			return "", err
		}
		// Hash exact wire raster bytes and media type; endpoint and auth
		// already select a separate secret-scoped directory.
		hash := sha256.New()
		hash.Write([]byte(src.MediaType))
		hash.Write([]byte{0})
		hash.Write(src.Data)
		var digest [32]byte
		copy(digest[:], hash.Sum(nil))
		if id := resolved[digest]; id != "" {
			return id, nil
		}
		record, err := a.resolveMessagesFile(bounded, ctx, digest, src)
		if err != nil {
			return "", err
		}
		resolved[digest] = record.ID
		return record.ID, nil
	})
	if !used {
		return nil
	}
	ids := make([]string, 0, len(resolved))
	for _, id := range resolved {
		ids = append(ids, id)
	}
	return ids
}

// An upload belongs to its adapter (route and credentials), not to whichever
// inference first needed the raster. The last departing waiter owns abort.
type messagesFileUpload struct {
	done    chan struct{}
	cancel  context.CancelFunc
	waiters int
	version uint64
	record  messagesFileRecord
	err     error
}

func (a *Adapter) resolveMessagesFile(ctx, parent context.Context, digest [32]byte, src messages.ImageSource) (messagesFileRecord, error) {
	var zero messagesFileRecord
	f := a.messagesFiles
	location := filepath.Join(f.root, hex.EncodeToString(digest[:])+".json")
	f.mu.Lock()
	if err := ctx.Err(); err != nil {
		f.mu.Unlock()
		return zero, err
	}
	now := time.Now()
	record := readMessagesFileRecord(location)
	if validMessagesFileID(record.ID) && record.Expires.After(now.Add(messagesFileRefreshMargin)) &&
		!record.Expires.After(now.Add(messagesFileLifetime)) && !f.isStale(record.ID) {
		f.mu.Unlock()
		return record, nil
	}
	op := f.uploads[digest]
	if op == nil {
		version, proceed := f.beginUploadLocked()
		if !proceed {
			f.mu.Unlock()
			return zero, errors.New("messages: Files upload skipped after timeout")
		}
		if err := a.reserveHTTPRequest(); err != nil {
			f.mu.Unlock()
			return zero, err
		}
		uploadCtx, cancel := context.WithTimeout(context.Background(), messagesFilesDeadline)
		op = &messagesFileUpload{done: make(chan struct{}), cancel: cancel, version: version}
		if f.uploads == nil {
			f.uploads = make(map[[32]byte]*messagesFileUpload)
		}
		f.uploads[digest] = op
		go func() {
			defer cancel()
			record, err := a.uploadMessagesFile(uploadCtx, src, now)
			f.mu.Lock()
			defer f.mu.Unlock()
			if f.uploads[digest] == op {
				if err == nil && f.isStale(record.ID) {
					err = errors.New("messages: upload returned a previously rejected file ID")
				}
				switch {
				case err == nil:
					f.finishUploadLocked(version, false)
					// A read-only or unavailable cache must not break online use.
					writeMessagesFileRecord(location, record)
				case errors.Is(err, context.DeadlineExceeded):
					f.finishUploadLocked(version, true)
				}
				delete(f.uploads, digest)
			}
			op.record, op.err = record, err
			close(op.done)
		}()
	}
	op.waiters++
	f.mu.Unlock()

	select {
	case <-op.done:
		if err := ctx.Err(); err != nil {
			return zero, err
		}
		return op.record, op.err
	case <-ctx.Done():
		f.mu.Lock()
		op.waiters--
		if op.waiters == 0 && f.uploads[digest] == op {
			// The capped resolution deadline can precede the shared HTTP
			// deadline. Neither user cancellation nor a caller's own
			// deadline counts as a provider timeout.
			if errors.Is(ctx.Err(), context.DeadlineExceeded) && parent.Err() == nil {
				f.finishUploadLocked(op.version, true)
			}
			delete(f.uploads, digest)
			op.cancel()
		}
		f.mu.Unlock()
		return zero, ctx.Err()
	}
}

// Tombstones are scoped to this endpoint and credential and name only the
// rejected ID. A newer cache entry installed by another writer is unaffected.
func (f *messagesFiles) staleMarker(id string) string {
	sum := sha256.Sum256([]byte(id))
	return filepath.Join(f.root, hex.EncodeToString(sum[:])+".stale")
}

func (f *messagesFiles) isStale(id string) bool {
	_, err := os.Stat(f.staleMarker(id))
	return err == nil
}

func (f *messagesFiles) markStale(id string) {
	if os.MkdirAll(f.root, 0700) != nil {
		return
	}
	if marker, err := os.OpenFile(f.staleMarker(id), os.O_CREATE|os.O_WRONLY, 0600); err == nil {
		_ = marker.Close()
	}
}

var staleFileReason = regexp.MustCompile(`(?i)\bfile(?:[_ -]?id)?\b[^\n]{0,120}(?:expired|not[ _-]found|deleted|does not exist|not created under)|(?:expired|missing|deleted)[^\n]{0,40}\bfile(?:[_ -]?id)?\b`)

func confirmedStaleMessagesID(status int, kind, code, message string, used []string) string {
	switch status {
	case http.StatusBadRequest, http.StatusNotFound, http.StatusGone:
	default:
		return ""
	}
	rejected := func(code string) bool {
		switch strings.ToLower(code) {
		case "file_not_found", "file_expired", "file_deleted", "invalid_file_id":
			return true
		default:
			return false
		}
	}
	if !rejected(kind) && !rejected(code) && !staleFileReason.MatchString(message) {
		return ""
	}
	var found string
	for _, id := range used {
		exact := regexp.MustCompile(`(?:^|[^\p{L}\p{N}_-])` + regexp.QuoteMeta(id) + `(?:$|[^\p{L}\p{N}_-])`)
		if exact.MatchString(message) {
			if found != "" && found != id {
				return ""
			}
			found = id
		}
	}
	return found
}

func (f *messagesFiles) upload(ctx context.Context, key string, source messages.ImageSource, now time.Time) (messagesFileRecord, error) {
	var body bytes.Buffer
	var zero messagesFileRecord
	m := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	filename := "image.png"
	if source.MediaType == "image/jpeg" {
		filename = "image.jpg"
	}
	if f.reclaim {
		var tag [16]byte
		if _, err := rand.Read(tag[:]); err != nil {
			return zero, err
		}
		filename = "pero-" + hex.EncodeToString(tag[:]) + "-" + filename
	}
	header.Set("Content-Disposition", `form-data; name="file"; filename="`+filename+`"`)
	header.Set("Content-Type", source.MediaType)
	part, err := m.CreatePart(header)
	if err != nil {
		return zero, err
	}
	if _, err := part.Write(source.Data); err != nil {
		return zero, err
	}
	if err := m.WriteField("expires_after[anchor]", "created_at"); err != nil {
		return zero, err
	}
	if err := m.WriteField("expires_after[seconds]", "604800"); err != nil {
		return zero, err
	}
	if err := m.Close(); err != nil {
		return zero, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, f.url, &body)
	if err != nil {
		return zero, err
	}
	req.Header.Set("Content-Type", m.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-API-Key", key)
	req.Header.Set("Anthropic-Version", "2023-06-01")
	req.Header.Set("Anthropic-Beta", messagesFilesBeta)
	req.Header.Set("User-Agent", "pero-agent/0.1")
	resp, err := f.client.Do(req)
	if err != nil {
		return zero, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return zero, messagesFilesUploadError(resp)
	}
	var uploaded struct {
		ID       string    `json:"id"`
		Type     string    `json:"type"`
		MIME     string    `json:"mime_type"`
		Bytes    int       `json:"size_bytes"`
		Created  time.Time `json:"created_at"`
		Filename string    `json:"filename"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxMessagesFileRecord)).Decode(&uploaded); err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return zero, context.DeadlineExceeded
		}
		return zero, errors.New("messages: invalid Files upload receipt")
	}
	if !validMessagesFileID(uploaded.ID) || uploaded.Type != "file" || uploaded.MIME != source.MediaType ||
		uploaded.Bytes != len(source.Data) || uploaded.Created.IsZero() || uploaded.Created.Before(now.Add(-time.Hour)) {
		return zero, errors.New("messages: invalid Files upload receipt")
	}
	expires := now.Add(messagesFileLifetime)
	if providerExpiry := uploaded.Created.Add(messagesFileLifetime); providerExpiry.Before(expires) {
		expires = providerExpiry
	}
	if f.reclaim && uploaded.Filename == filename && reclaimableMessagesID.MatchString(uploaded.ID) {
		writeMessagesFileRecord(f.ownedReceipt(uploaded.ID), messagesFileRecord{ID: uploaded.ID, Expires: expires, Filename: filename})
	}
	return messagesFileRecord{ID: uploaded.ID, Expires: expires}, nil
}

func validMessagesFileID(s string) bool {
	return s != "" && len(s) <= 512 && !strings.ContainsAny(s, " \r\n\t\x00")
}

func readMessagesFileRecord(path string) messagesFileRecord {
	f, err := os.Open(path)
	if err != nil {
		return messagesFileRecord{}
	}
	defer f.Close()
	var record messagesFileRecord
	if json.NewDecoder(io.LimitReader(f, maxMessagesFileRecord)).Decode(&record) != nil {
		return messagesFileRecord{}
	}
	return record
}

func writeMessagesFileRecord(path string, record messagesFileRecord) {
	dir := filepath.Dir(path)
	if os.MkdirAll(dir, 0700) != nil {
		return
	}
	f, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		return
	}
	defer os.Remove(f.Name())
	encodeErr := json.NewEncoder(f).Encode(record)
	closeErr := f.Close()
	if encodeErr == nil && closeErr == nil {
		_ = os.Rename(f.Name(), path)
	}
}
