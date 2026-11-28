// Package paperdomain admits one PDF into a persisted Paper revision.
// The id is minted by this package. It is not a digest prefix.
package paperdomain

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
)

const (
	Host       = "pero-paper"
	App        = "paper-agent"
	AppVersion = "1"
	Media      = "application/pdf"
	maxBytes   = 32 * 1024 * 1024
)

var ErrRejected = errors.New("rejected")

// Record is one immutable Paper revision. Body is the domain copy.
type Record struct {
	ID           string
	Project      string
	OwnerHost    string
	LocalProject string
	AppInstance  string
	AppVersion   string
	Revision     string
	MediaType    string
	Body         []byte
}

// MintID returns a new Paper id. The caller does not choose the shape.
func MintID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return "rev_" + hex.EncodeToString(raw[:]), nil
}

// Place returns the stored revision for this digest, or a new one when none exists.
// created is false when existing already holds the digest.
func Place(project string, body []byte, digest string, existing *Record, minted string) (Record, bool, error) {
	if project == "" || strings.Contains(project, "..") || strings.ContainsAny(project, "/\\") {
		return Record{}, false, ErrRejected
	}
	if len(body) == 0 || len(body) > maxBytes {
		return Record{}, false, ErrRejected
	}
	sum := sha256.Sum256(body)
	if hex.EncodeToString(sum[:]) != digest {
		return Record{}, false, ErrRejected
	}
	if existing != nil && existing.Project == project && existing.Revision == digest && existing.ID != "" {
		copy := *existing
		copy.Body = append([]byte(nil), existing.Body...)
		return copy, false, nil
	}
	if minted == "" || minted == "paper-"+digest[:12] || minted == "doc-"+digest[:12] || strings.HasPrefix(minted, "paper-") || strings.HasPrefix(minted, "doc-") {
		return Record{}, false, ErrRejected
	}
	if strings.Contains(minted, "..") || strings.ContainsAny(minted, "/\\") {
		return Record{}, false, ErrRejected
	}
	return Record{
		ID: minted, Project: project, OwnerHost: Host, LocalProject: project,
		AppInstance: App + "@" + Host, AppVersion: AppVersion, Revision: digest,
		MediaType: Media, Body: append([]byte(nil), body...),
	}, true, nil
}
