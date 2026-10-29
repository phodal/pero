package artifacts

import (
	"reflect"
	"slices"
	"time"
)

const CollectorAudience = "pero-export"
const MaxCollectionDuration = 15 * time.Minute

// CollectorAuthority is an observed Pod-bound identity, not a token or a claim
// submitted by the collector. Admission requires an online TokenReview and an
// exact comparison against these persisted fields on every request.
type CollectorAuthority struct {
	Namespace         string    `json:"namespace"`
	ServiceAccount    string    `json:"service_account"`
	ServiceAccountUID string    `json:"service_account_uid"`
	PodUID            string    `json:"pod_uid"`
	Audience          string    `json:"audience"`
	ExpiresAt         time.Time `json:"expires_at"`
}

func (e Export) BindCollector(a CollectorAuthority, now time.Time) (Export, error) {
	a.ExpiresAt = a.ExpiresAt.UTC()
	for _, key := range []string{a.Namespace, a.ServiceAccount, a.ServiceAccountUID, a.PodUID} {
		if !keyPattern.MatchString(key) {
			return e, ErrInvalid
		}
	}
	if a.Namespace != e.Source.Namespace || a.Audience != CollectorAudience || !a.ExpiresAt.After(now) || a.ExpiresAt.After(now.Add(MaxCollectionDuration)) {
		return e, ErrInvalid
	}
	if e.Collector != nil && reflect.DeepEqual(*e.Collector, a) {
		return e, nil
	}
	if e.Phase != Collecting || e.Quiescence == nil || e.GC != nil || e.Collector != nil && e.Collector.ExpiresAt.After(now) {
		return e, ErrConflict
	}
	e.Collector = &a
	return e, nil
}

// FileEntry is the single conversion from bounded upload metadata to a file
// identity; the object key and path come from the frozen export, not HTTP input.
func (e Export) FileEntry(id string, size int64, digest string) (Entry, error) {
	if size < 0 || size > e.Policy.MaxFileBytes || !digestPattern.MatchString(digest) {
		return Entry{}, ErrInvalid
	}
	index := slices.IndexFunc(e.Policy.Paths, func(path string) bool { return EntryID(path) == id })
	if index < 0 {
		return Entry{}, ErrInvalid
	}
	path := e.Policy.Paths[index]
	return Entry{ID: id, Path: path, Bytes: size, SHA256: digest, ObjectKey: ObjectKey(e.Source, e.ID, path, digest)}, nil
}
