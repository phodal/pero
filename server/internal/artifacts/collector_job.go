package artifacts

import "time"

// CollectorJob is reserved durably before any Kubernetes create. A reserved but
// unconfirmed create is reconciled by GET only, never blindly re-posted. The
// observed UID is added once; Job replacement cannot inherit export authority.
type CollectorJob struct {
	Name              string    `json:"name"`
	Namespace         string    `json:"namespace"`
	UID               string    `json:"uid,omitempty"`
	ServiceAccount    string    `json:"service_account"`
	ServiceAccountUID string    `json:"service_account_uid"`
	ConfigDigest      string    `json:"config_digest"`
	ExpiresAt         time.Time `json:"expires_at"`
}

func (e Export) WithCollectorJob(j CollectorJob, now time.Time) (Export, error) {
	j.ExpiresAt = j.ExpiresAt.UTC()
	if !keyPattern.MatchString(j.ServiceAccount) || !keyPattern.MatchString(j.ServiceAccountUID) || !keyPattern.MatchString(j.Name) || j.Namespace != e.Source.Namespace || !digestPattern.MatchString(j.ConfigDigest) || j.UID != "" && !keyPattern.MatchString(j.UID) {
		return e, ErrInvalid
	}
	if e.CollectorJob != nil {
		old := *e.CollectorJob
		if old.Name != j.Name || old.Namespace != j.Namespace || old.ConfigDigest != j.ConfigDigest || old.ServiceAccount != j.ServiceAccount || old.ServiceAccountUID != j.ServiceAccountUID || !old.ExpiresAt.Equal(j.ExpiresAt) || old.UID != "" && old.UID != j.UID {
			return e, ErrConflict
		}
		if old == j {
			return e, nil
		}
	} else if e.Phase != Collecting || j.UID != "" || !j.ExpiresAt.After(now) || j.ExpiresAt.After(now.Add(MaxCollectionDuration)) {
		return e, ErrInvalid
	}
	if e.Quiescence == nil || (e.Phase != Collecting && e.Phase != Committed) || (e.GC != nil && e.CollectorJob == nil) {
		return e, ErrNotReady
	}
	e.CollectorJob = &j
	return e, nil
}
