package artifacts

import (
	"reflect"
	"strings"
	"time"
)

const (
	Reserved   = "reserved"
	Collecting = "collecting"
	Committed  = "committed"
)

// Quiescence references evidence supplied by the trusted compute/storage
// owners. API Pod absence alone MUST NOT mint StorageFenceDigest. The collector
// must not mount until both original writer termination and volume fencing have
// been established by the selected backend.
type Quiescence struct {
	PodUID               string    `json:"pod_uid"`
	PVCUID               string    `json:"pvc_uid"`
	ComputeReleaseDigest string    `json:"compute_release_digest"`
	StorageFenceDigest   string    `json:"storage_fence_digest"`
	ObservedAt           time.Time `json:"observed_at"`
}

// GCApproval is a data-deletion authorization, not a deletion receipt. An
// explicit discard requires an authenticated actor and reason; it is never
// inferred from cancellation, retention expiry, or a failed upload.
type GCApproval struct {
	OperationID    string    `json:"operation_id"`
	ActorID        string    `json:"actor_id"`
	Discard        bool      `json:"discard"`
	Reason         string    `json:"reason,omitempty"`
	ManifestDigest string    `json:"manifest_digest,omitempty"`
	ApprovedAt     time.Time `json:"approved_at"`
}

type Export struct {
	ID           string      `json:"id"`
	Version      int64       `json:"version"`
	Source       Source      `json:"source"`
	Policy       Policy      `json:"policy"`
	PolicyDigest string      `json:"policy_digest"`
	Phase        string      `json:"phase"`
	CreatedAt    time.Time   `json:"created_at"`
	Quiescence   *Quiescence `json:"quiescence,omitempty"`
	Manifest     *Manifest   `json:"manifest,omitempty"`
	GC           *GCApproval `json:"gc,omitempty"`
}

func NewExport(source Source, policy Policy, operationID string, now time.Time) (Export, error) {
	p, err := policy.Canonical()
	if err != nil || source.Validate() != nil || !keyPattern.MatchString(operationID) || now.IsZero() {
		return Export{}, ErrInvalid
	}
	digest, _ := Digest(p)
	return Export{ID: operationID, Version: 1, Source: source, Policy: p, PolicyDigest: digest, Phase: Reserved, CreatedAt: now.UTC()}, nil
}

func (e Export) Begin(q Quiescence) (Export, error) {
	q.ObservedAt = q.ObservedAt.UTC()
	if q.PodUID != e.Source.PodUID || q.PVCUID != e.Source.PVCUID || !digestPattern.MatchString(q.ComputeReleaseDigest) || !digestPattern.MatchString(q.StorageFenceDigest) || q.ObservedAt.Before(e.CreatedAt) {
		return e, ErrInvalid
	}
	if e.Quiescence != nil {
		if !reflect.DeepEqual(*e.Quiescence, q) {
			return e, ErrConflict
		}
		return e, nil
	}
	if e.Phase != Reserved || e.GC != nil {
		return e, ErrConflict
	}
	e.Phase = Collecting
	e.Quiescence = &q
	return e, nil
}

func (e Export) Commit(m Manifest) (Export, error) {
	if m.Validate(e.Policy) != nil || m.Source != e.Source || m.OperationID != e.ID || m.PolicyDigest != e.PolicyDigest {
		return e, ErrConflict
	}
	if e.Manifest != nil {
		if !reflect.DeepEqual(*e.Manifest, m) {
			return e, ErrConflict
		}
		return e, nil
	}
	if e.Phase != Collecting || e.Quiescence == nil || e.GC != nil || m.CreatedAt.Before(e.Quiescence.ObservedAt) {
		return e, ErrNotReady
	}
	e.Phase = Committed
	e.Manifest = &m
	return e, nil
}

func (e Export) AllowDataGC(a GCApproval) (Export, error) {
	a.ApprovedAt = a.ApprovedAt.UTC()
	if !keyPattern.MatchString(a.OperationID) || !keyPattern.MatchString(a.ActorID) || a.ApprovedAt.Before(e.CreatedAt) {
		return e, ErrInvalid
	}
	if e.GC != nil {
		if !reflect.DeepEqual(*e.GC, a) {
			return e, ErrConflict
		}
		return e, nil
	}
	if e.Quiescence == nil || a.ApprovedAt.Before(e.Quiescence.ObservedAt) {
		return e, ErrNotReady
	}
	if a.Discard {
		if strings.TrimSpace(a.Reason) == "" || len(a.Reason) > 512 || strings.ContainsAny(a.Reason, "\x00\r\n") || a.ManifestDigest != "" || e.Manifest != nil {
			return e, ErrInvalid
		}
	} else if e.Manifest == nil || a.ManifestDigest != e.Manifest.Digest || a.Reason != "" || a.ApprovedAt.Before(e.Manifest.CreatedAt) {
		return e, ErrNotReady
	}
	e.GC = &a
	return e, nil
}
