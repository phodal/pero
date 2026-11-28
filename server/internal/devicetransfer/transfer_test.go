package devicetransfer

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

var pdf = []byte("%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")

func sample() Transfer {
	sum := sha256.Sum256(pdf)
	return Transfer{
		UploadID: "upload-1", Project: "lab", App: "paper-agent", HandleID: "handle-1",
		Digest: hex.EncodeToString(sum[:]), Size: uint64(len(pdf)), MediaType: "application/pdf", Received: uint64(len(pdf)),
	}
}

func TestImportCommitsOneRevision(t *testing.T) {
	transfer := sample()
	first, err := Finalize(true, "lab", transfer, pdf, true, false, nil, "doc-1", transfer.Digest)
	if err != "" || !first.Created || first.PaperID != "doc-1" || first.Digest != transfer.Digest || first.PaperID == "paper-"+transfer.Digest[:12] {
		t.Fatalf("%+v %s", first, err)
	}
	again, err := Finalize(true, "lab", transfer, pdf, true, false, &first, "doc-1", first.Revision)
	if err != "" || again.Created || again.Revision != first.Revision {
		t.Fatalf("%+v %s", again, err)
	}
	partial := transfer
	partial.Received = 1
	if _, err = Finalize(true, "lab", partial, pdf, true, false, nil, "doc-1", transfer.Digest); err != Interrupted {
		t.Fatal(err)
	}
	cancelled := transfer
	cancelled.Cancelled = true
	if _, err = Finalize(true, "lab", cancelled, pdf, true, false, nil, "doc-1", transfer.Digest); err != CancelledTransfer {
		t.Fatal(err)
	}
	if _, err = Finalize(true, "lab", transfer, pdf, false, false, nil, "doc-1", transfer.Digest); err != Foreign {
		t.Fatal(err)
	}
	if _, err = Finalize(true, "lab", transfer, pdf, true, true, nil, "doc-1", transfer.Digest); err != Expired {
		t.Fatal(err)
	}
	if _, err = Finalize(false, "lab", transfer, pdf, true, false, nil, "doc-1", transfer.Digest); err != Revoked {
		t.Fatal(err)
	}
	if _, err = Finalize(true, "other", transfer, pdf, true, false, nil, "doc-1", transfer.Digest); err != WrongProject {
		t.Fatal(err)
	}
	other := transfer
	other.App = "other-app"
	if _, err = Finalize(true, "lab", other, pdf, true, false, nil, "doc-1", transfer.Digest); err != WrongApp {
		t.Fatal(err)
	}
	huge := transfer
	huge.Size = MaxBytes + 1
	if _, err = Finalize(true, "lab", huge, pdf, true, false, nil, "doc-1", transfer.Digest); err != OverLimit {
		t.Fatal(err)
	}
	bad := transfer
	bad.Digest = "ab"
	if _, err = Finalize(true, "lab", bad, pdf, true, false, nil, "doc-1", transfer.Digest); err != DigestMismatch {
		t.Fatal(err)
	}
	walked := transfer
	walked.HandleID = "../secret"
	if _, err = Finalize(true, "lab", walked, pdf, true, false, nil, "doc-1", transfer.Digest); err != Traversal {
		t.Fatal(err)
	}
}
