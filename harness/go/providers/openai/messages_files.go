package openai

import (
	"bytes"
	"context"
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
	"strings"
	"time"

	"github.com/phodal/pero/harness/go/providers/messages"
)

const messagesFilesBeta = "files-api-2025-04-14"
const messagesFileLifetime = 7 * 24 * time.Hour
const messagesFilesDeadline = 20 * time.Second
const maxMessagesFileRecord = 4096

type messagesFiles struct {
	client    *http.Client
	url, root string
}

type messagesFileRecord struct {
	ID      string    `json:"id"`
	Expires time.Time `json:"expires"`
}

func (a *Adapter) preferMessagesFiles(ctx context.Context, wire *messages.Request) bool {
	files := a.messagesFiles
	bounded, cancel := context.WithTimeout(ctx, messagesFilesDeadline)
	defer cancel()
	resolved := make(map[[32]byte]string)
	return wire.PreferFiles(func(src messages.ImageSource) (string, error) {
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
		location := filepath.Join(files.root, hex.EncodeToString(digest[:])+".json")
		now := time.Now()
		record := readMessagesFileRecord(location)
		if !validMessagesFileID(record.ID) || !record.Expires.After(now.Add(time.Hour)) ||
			record.Expires.After(now.Add(messagesFileLifetime)) {
			if err := a.reserveHTTPRequest(); err != nil {
				return "", err
			}
			var err error
			record, err = files.upload(bounded, a.messagesKey, src, now)
			if err != nil {
				return "", err
			}
			// A read-only or unavailable cache must not break online use.
			writeMessagesFileRecord(location, record)
		}
		resolved[digest] = record.ID
		return record.ID, nil
	})
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
		return zero, errors.New("messages: Files upload failed")
	}
	var uploaded struct {
		ID      string    `json:"id"`
		Type    string    `json:"type"`
		MIME    string    `json:"mime_type"`
		Bytes   int       `json:"size_bytes"`
		Created time.Time `json:"created_at"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, maxMessagesFileRecord)).Decode(&uploaded) != nil ||
		!validMessagesFileID(uploaded.ID) || uploaded.Type != "file" || uploaded.MIME != source.MediaType ||
		uploaded.Bytes != len(source.Data) || uploaded.Created.IsZero() || uploaded.Created.Before(now.Add(-time.Hour)) {
		return zero, errors.New("messages: invalid Files upload receipt")
	}
	expires := now.Add(messagesFileLifetime)
	if providerExpiry := uploaded.Created.Add(messagesFileLifetime); providerExpiry.Before(expires) {
		expires = providerExpiry
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
