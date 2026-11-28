package store

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

var ErrEnrollmentInput = errors.New("invalid local Worker enrollment")

// WorkerCapability is an exact execution tuple. Project access alone is not
// evidence that a device has a compatible checkout or Agent.
type WorkerCapability struct {
	ProjectID    string `json:"project_id"`
	WorkspaceKey string `json:"workspace_key"`
	AgentID      string `json:"agent_id"`
}

type WorkerEnrollmentRequest struct {
	DeviceID         string             `json:"device_id"`
	RequestID        string             `json:"request_id"`
	Name             string             `json:"name"`
	Projects         []string           `json:"projects"`
	Capabilities     []WorkerCapability `json:"capabilities"`
	EnrollmentSecret string             `json:"enrollment_secret"`
}

// DeviceEnrollment contains an authorized, canonical request. Its secret is
// supplied by the device and survives a lost HTTP reply without storing a
// plaintext bearer credential on the server.
type DeviceEnrollment struct {
	ownerID string
	request WorkerEnrollmentRequest
}

func (r WorkerEnrollmentRequest) Authorize(client *Client) (DeviceEnrollment, error) {
	validID := func(v string) bool {
		return strings.TrimSpace(v) != "" && len(v) <= 128 && utf8.ValidString(v) && !strings.ContainsFunc(v, unicode.IsControl)
	}
	secret, err := hex.DecodeString(r.EnrollmentSecret)
	if !validID(r.DeviceID) || !validID(r.RequestID) || !validID(r.Name) || err != nil || len(secret) != 32 || len(r.EnrollmentSecret) != 64 || strings.ToLower(r.EnrollmentSecret) != r.EnrollmentSecret || len(r.Projects) == 0 || len(r.Projects) > 64 || len(r.Capabilities) == 0 || len(r.Capabilities) > 256 {
		return DeviceEnrollment{}, ErrEnrollmentInput
	}
	r.Projects = append([]string(nil), r.Projects...)
	slices.Sort(r.Projects)
	r.Projects = slices.Compact(r.Projects)
	seen := map[WorkerCapability]bool{}
	covered := map[string]bool{}
	capabilities := make([]WorkerCapability, 0, len(r.Capabilities))
	for _, capability := range r.Capabilities {
		if !validID(capability.ProjectID) || !validID(capability.WorkspaceKey) || !validID(capability.AgentID) || !slices.Contains(r.Projects, capability.ProjectID) {
			return DeviceEnrollment{}, ErrEnrollmentInput
		}
		covered[capability.ProjectID] = true
		if !seen[capability] {
			capabilities = append(capabilities, capability)
			seen[capability] = true
		}
	}
	for _, project := range r.Projects {
		if !validID(project) || !covered[project] {
			return DeviceEnrollment{}, ErrEnrollmentInput
		}
		if client.Role != "operator" && !slices.Contains(client.Projects, project) {
			return DeviceEnrollment{}, ErrForbidden
		}
	}
	slices.SortFunc(capabilities, func(a, b WorkerCapability) int {
		return strings.Compare(a.ProjectID+"\x00"+a.WorkspaceKey+"\x00"+a.AgentID, b.ProjectID+"\x00"+b.WorkspaceKey+"\x00"+b.AgentID)
	})
	r.Capabilities = capabilities
	return DeviceEnrollment{ownerID: client.ID, request: r}, nil
}

func (s *Store) EnrollWorker(ctx context.Context, enrollment DeviceEnrollment) (Worker, string, error) {
	r := enrollment.request
	encoded, _ := json.Marshal(r)
	fingerprint := sha256.Sum256(encoded)
	capabilities, _ := json.Marshal(r.Capabilities)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Worker{}, "", err
	}
	defer tx.Rollback(ctx)
	// Serialize enrollment retries for the stable device, including first use.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, enrollment.ownerID+":"+r.DeviceID); err != nil {
		return Worker{}, "", err
	}
	var w Worker
	var last string
	err = tx.QueryRow(ctx, `SELECT w.id,w.name,w.projects,w.labels,d.last_request_id FROM worker_devices d JOIN workers w ON w.id=d.worker_id WHERE d.owner_id=$1 AND d.device_id=$2 FOR UPDATE OF w`, enrollment.ownerID, r.DeviceID).Scan(&w.ID, &w.Name, &w.Projects, &w.Labels, &last)
	exists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Worker{}, "", err
	}
	var previous []byte
	err = tx.QueryRow(ctx, `SELECT fingerprint FROM worker_enrollment_receipts WHERE owner_id=$1 AND device_id=$2 AND request_id=$3`, enrollment.ownerID, r.DeviceID, r.RequestID).Scan(&previous)
	if err == nil {
		if last != r.RequestID || subtle.ConstantTimeCompare(previous, fingerprint[:]) != 1 {
			return Worker{}, "", ErrConflict
		}
		var enabled bool
		if err = tx.QueryRow(ctx, `SELECT enabled FROM worker_devices WHERE worker_id=$1`, w.ID).Scan(&enabled); err != nil {
			return Worker{}, "", err
		}
		if !enabled {
			return Worker{}, "", ErrConflict
		}
		return w, w.ID + "." + r.EnrollmentSecret, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Worker{}, "", err
	}
	if exists {
		var busy bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM runs WHERE worker_id=$1 AND `+holdsWorkerSlot+`)`, w.ID).Scan(&busy); err != nil {
			return Worker{}, "", err
		}
		if busy {
			return Worker{}, "", ErrConflict
		}
	} else {
		w.ID = newID("worker")
	}
	w.Name = r.Name
	w.Projects = r.Projects
	w.Labels = []string{"desktop"}
	token := w.ID + "." + r.EnrollmentSecret
	tokenHash := sha256.Sum256([]byte(token))
	if _, err = tx.Exec(ctx, `INSERT INTO workers(id,name,projects,labels,token_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,projects=EXCLUDED.projects,labels=EXCLUDED.labels,token_hash=EXCLUDED.token_hash`, w.ID, w.Name, w.Projects, w.Labels, tokenHash[:]); err != nil {
		return Worker{}, "", err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO worker_devices(worker_id,owner_id,device_id,capabilities,last_request_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(worker_id) DO UPDATE SET capabilities=EXCLUDED.capabilities,last_request_id=EXCLUDED.last_request_id,enabled=true`, w.ID, enrollment.ownerID, r.DeviceID, capabilities, r.RequestID); err != nil {
		return Worker{}, "", err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO worker_enrollment_receipts(owner_id,device_id,request_id,worker_id,fingerprint) VALUES($1,$2,$3,$4,$5)`, enrollment.ownerID, r.DeviceID, r.RequestID, w.ID, fingerprint[:]); err != nil {
		return Worker{}, "", err
	}
	return w, token, tx.Commit(ctx)
}

func (s *Store) DisableOwnedWorker(ctx context.Context, ownerID, workerID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var id string
	if err = tx.QueryRow(ctx, `SELECT w.id FROM workers w JOIN worker_devices d ON d.worker_id=w.id WHERE w.id=$1 AND d.owner_id=$2 FOR UPDATE OF w`, workerID, ownerID).Scan(&id); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	var busy bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM runs WHERE worker_id=$1 AND `+holdsWorkerSlot+`)`, id).Scan(&busy); err != nil {
		return err
	}
	if busy {
		return ErrConflict
	}
	if _, err = tx.Exec(ctx, `UPDATE worker_devices SET enabled=false WHERE worker_id=$1`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
