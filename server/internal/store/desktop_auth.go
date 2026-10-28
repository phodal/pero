package store

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
)

// DesktopGrant binds a short-lived code to the Desktop that initiated sign-in.
// Browser URLs carry the code, never the resulting bearer credential.
type DesktopGrant struct {
	UserID    int64
	Challenge string
	ExpiresAt time.Time
}

var desktopProof = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

func ValidDesktopProof(value string) bool { return desktopProof.MatchString(value) }
func (g DesktopGrant) Redeem(verifier string, now time.Time) error {
	if !now.Before(g.ExpiresAt) || !ValidDesktopProof(verifier) {
		return ErrForbidden
	}
	digest := sha256.Sum256([]byte(verifier))
	actual := base64.RawURLEncoding.EncodeToString(digest[:])
	if subtle.ConstantTimeCompare([]byte(g.Challenge), []byte(actual)) != 1 {
		return ErrForbidden
	}
	return nil
}
func (s *Store) CreateDesktopGrant(ctx context.Context, code string, grant DesktopGrant) error {
	hash := sha256.Sum256([]byte(code))
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `DELETE FROM desktop_grants WHERE expires_at < now()`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO desktop_grants(digest,user_id,challenge,expires_at) VALUES($1,$2,$3,$4)`, hash[:], grant.UserID, grant.Challenge, grant.ExpiresAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ExchangeDesktopGrant consumes once and issues a per-device credential for the
// existing GitHub client. Its project scope remains owned by the operator.
func (s *Store) ExchangeDesktopGrant(ctx context.Context, code, verifier string, now time.Time) (string, error) {
	hash := sha256.Sum256([]byte(code))
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var grant DesktopGrant
	err = tx.QueryRow(ctx, `SELECT user_id,challenge,expires_at FROM desktop_grants WHERE digest=$1 FOR UPDATE`, hash[:]).Scan(&grant.UserID, &grant.Challenge, &grant.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrForbidden
	}
	if err != nil {
		return "", err
	}
	if err = grant.Redeem(verifier, now); err != nil {
		return "", err
	}
	id := newID("desktop")
	token := id + "." + newID("secret")
	digest := sha256.Sum256([]byte(token))
	if _, err = tx.Exec(ctx, `INSERT INTO desktop_credentials(id,client_id,token_hash) SELECT $1,client_id,$2 FROM community_users WHERE id=$3`, id, digest[:], grant.UserID); err != nil {
		return "", err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM desktop_grants WHERE digest=$1`, hash[:]); err != nil {
		return "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return token, nil
}
