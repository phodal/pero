package openai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/phodal/pero/harness/go/providers/messages"
)

var errMessagesFilesQuota = errors.New("messages: Files storage quota exhausted")
var reclaimableMessagesID = regexp.MustCompile(`^file-[a-zA-Z0-9_-]{1,240}$`)
var messagesFilesStorageQuota = regexp.MustCompile(`(?i)\b(storage (?:quota|limit)|file (?:count|storage) (?:quota|limit)|too many (?:stored )?files|stored files limit)\b`)

func messagesFilesUploadError(response *http.Response) error {
	switch response.StatusCode {
	case http.StatusBadRequest, http.StatusTooManyRequests, http.StatusInsufficientStorage:
		var failure struct {
			Error struct{ Code, Type, Message string }
		}
		if json.NewDecoder(io.LimitReader(response.Body, maxMessagesFileRecord)).Decode(&failure) == nil {
			for _, code := range []string{failure.Error.Code, failure.Error.Type} {
				switch strings.ToLower(code) {
				case "storage_quota_exceeded", "file_count_limit_exceeded", "file_storage_limit_exceeded":
					return errMessagesFilesQuota
				}
			}
			if messagesFilesStorageQuota.MatchString(failure.Error.Message) {
				return errMessagesFilesQuota
			}
		}
	}
	return errors.New("messages: Files upload failed")
}

func (f *messagesFiles) ownedReceipt(id string) string {
	digest := sha256.Sum256([]byte(id))
	return filepath.Join(f.root, hex.EncodeToString(digest[:])+".owned")
}

func (a *Adapter) uploadMessagesFile(ctx context.Context, src messages.ImageSource, now time.Time) (messagesFileRecord, error) {
	f := a.messagesFiles
	record, err := f.upload(ctx, a.messagesKey, src, now)
	if !f.reclaim || !errors.Is(err, errMessagesFilesQuota) || ctx.Err() != nil {
		return record, err
	}
	// Reserve the complete recovery before listing. Never delete a file when
	// the inference would have insufficient budget to retry the original POST.
	const recoveryAttempts = 3
	if a.reserveHTTPAttempts(recoveryAttempts) != nil {
		return record, err
	}
	unused := int64(recoveryAttempts)
	defer func() {
		if a.maxRequests > 0 {
			a.requests.Add(-unused)
		}
	}()
	unused--
	candidate := f.reclaimCandidate(ctx, a.messagesKey, now)
	if candidate == "" || ctx.Err() != nil {
		return record, err
	}
	unused--
	var deleted struct{ ID, Type string }
	if !f.fileOperation(ctx, http.MethodDelete, f.url+"/"+candidate, a.messagesKey, maxMessagesFileRecord, &deleted) ||
		deleted.ID != candidate || deleted.Type != "file_deleted" {
		return record, err
	}
	f.markStale(candidate)
	if ctx.Err() != nil {
		return record, err
	}
	unused--
	return f.upload(ctx, a.messagesKey, src, time.Now())
}

func (f *messagesFiles) reclaimCandidate(ctx context.Context, key string, now time.Time) string {
	// The listing is account-wide. A filename prefix or credential access
	// never grants deletion authority; require the exact upload receipt.
	var page struct {
		Data []struct{ ID, Type, Filename string }
	}
	if !f.fileOperation(ctx, http.MethodGet, f.url+"?limit=20", key, 64<<10, &page) || len(page.Data) > 20 {
		return ""
	}
	var candidate messagesFileRecord
	seen := make(map[string]struct{})
	for _, entry := range page.Data {
		if entry.Type != "file" || !reclaimableMessagesID.MatchString(entry.ID) || entry.Filename == "" {
			return ""
		}
		if _, exists := seen[entry.ID]; exists {
			return ""
		}
		seen[entry.ID] = struct{}{}
		receipt := readMessagesFileRecord(f.ownedReceipt(entry.ID))
		if receipt.ID != entry.ID || receipt.Filename != entry.Filename ||
			receipt.Expires.IsZero() || receipt.Expires.After(now.Add(messagesFileRefreshMargin)) ||
			f.isStale(entry.ID) {
			continue
		}
		if candidate.ID == "" || receipt.Expires.Before(candidate.Expires) {
			candidate = receipt
		}
	}
	return candidate.ID
}

func (f *messagesFiles) fileOperation(ctx context.Context, method, url, key string, bound int64, destination any) bool {
	request, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		return false
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-API-Key", key)
	request.Header.Set("Anthropic-Version", "2023-06-01")
	request.Header.Set("Anthropic-Beta", messagesFilesBeta)
	response, err := f.client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, bound+1))
	return err == nil && int64(len(raw)) <= bound && json.Unmarshal(raw, destination) == nil
}
