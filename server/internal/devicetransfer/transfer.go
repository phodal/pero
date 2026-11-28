// Package devicetransfer commits one picked file into an existing Paper revision.
// The bytes are checked here and then handed to the domain. They are not stored again.
package devicetransfer

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

const MaxBytes = 32 * 1024 * 1024

const (
	Cancelled         = "cancelled"
	Denied            = "denied"
	Offline           = "offline"
	Foreign           = "foreign"
	Expired           = "expired"
	Traversal         = "traversal"
	OverLimit         = "over_limit"
	DigestMismatch    = "digest_mismatch"
	WrongProject      = "wrong_project"
	WrongApp          = "wrong_app"
	Revoked           = "revoked"
	Interrupted       = "interrupted"
	Conflict          = "conflict"
	CancelledTransfer = "cancelled_transfer"
)

type Handle struct {
	ID        string
	Provider  string
	MediaType string
	Size      uint64
	Name      string
}

type Transfer struct {
	UploadID  string
	Project   string
	App       string
	HandleID  string
	Digest    string
	Size      uint64
	MediaType string
	Received  uint64
	Cancelled bool
}

type Commit struct {
	PaperID  string `json:"paperId"`
	Revision string `json:"revision"`
	Digest   string `json:"digest"`
	Created  bool   `json:"created"`
}

func Finalize(member bool, project string, transfer Transfer, body []byte, known, expired bool, prior *Commit, imported string) (Commit, string) {
	if !member {
		return Commit{}, Revoked
	}
	if traversed(transfer.UploadID) || traversed(transfer.HandleID) || traversed(transfer.Project) || traversed(transfer.App) {
		return Commit{}, Traversal
	}
	if transfer.Project != project {
		return Commit{}, WrongProject
	}
	if transfer.App != "paper-agent" {
		return Commit{}, WrongApp
	}
	if transfer.MediaType != "application/pdf" || transfer.Size > MaxBytes || uint64(len(body)) > MaxBytes {
		return Commit{}, OverLimit
	}
	if !known {
		return Commit{}, Foreign
	}
	if expired {
		return Commit{}, Expired
	}
	if transfer.Cancelled {
		return Commit{}, CancelledTransfer
	}
	if transfer.Received != transfer.Size || uint64(len(body)) != transfer.Size {
		return Commit{}, Interrupted
	}
	sum := sha256.Sum256(body)
	actual := hex.EncodeToString(sum[:])
	if actual != transfer.Digest {
		return Commit{}, DigestMismatch
	}
	if prior != nil {
		if prior.Digest == transfer.Digest {
			copy := *prior
			copy.Created = false
			return copy, ""
		}
		return Commit{}, Conflict
	}
	revision := actual
	created := true
	if imported != "" {
		revision = imported
		created = false
	}
	return Commit{PaperID: "paper-" + actual[:12], Revision: revision, Digest: actual, Created: created}, ""
}

func traversed(value string) bool {
	return strings.Contains(value, "..") || strings.ContainsAny(value, "/\\\x00")
}
