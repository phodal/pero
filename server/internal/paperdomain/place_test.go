package paperdomain

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

func TestPlaceKeepsTheDomainID(t *testing.T) {
	body := []byte("%PDF-1.1\n")
	sum := sha256.Sum256(body)
	digest := hex.EncodeToString(sum[:])
	if _, _, err := Place("lab", body, digest, nil, "paper-"+digest[:12]); err != ErrRejected {
		t.Fatal(err)
	}
	if _, _, err := Place("lab", body, digest, nil, "doc-"+digest[:12]); err != ErrRejected {
		t.Fatal(err)
	}
	id, err := MintID()
	if err != nil || id == "" || id[:4] != "rev_" {
		t.Fatal(id, err)
	}
	first, created, err := Place("lab", body, digest, nil, id)
	if err != nil || !created || first.ID != id || first.Revision != digest || first.OwnerHost != Host || first.LocalProject != "lab" {
		t.Fatalf("%v %v %#v", created, err, first)
	}
	again, created, err := Place("lab", body, digest, &first, "rev_other")
	if err != nil || created || again.ID != id {
		t.Fatalf("retry %v %v %s", created, err, again.ID)
	}
}
