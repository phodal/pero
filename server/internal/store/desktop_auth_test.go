package store

import (
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestDesktopGrant(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	verifier := strings.Repeat("a", 43)
	digest := sha256.Sum256([]byte(verifier))
	grant := DesktopGrant{UserID: 101, Challenge: base64.RawURLEncoding.EncodeToString(digest[:]), ExpiresAt: now.Add(time.Minute)}
	for _, tc := range []struct {
		name, verifier string
		at             time.Time
		allowed        bool
	}{
		{"initiating Desktop", verifier, now, true},
		{"other Desktop", strings.Repeat("b", 43), now, false},
		{"malformed proof", "", now, false},
		{"expiry boundary", verifier, grant.ExpiresAt, false},
		{"expired", verifier, grant.ExpiresAt.Add(time.Second), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := grant.Redeem(tc.verifier, tc.at); (err == nil) != tc.allowed {
				t.Fatalf("allowed=%v error=%v", tc.allowed, err)
			}
		})
	}
}
