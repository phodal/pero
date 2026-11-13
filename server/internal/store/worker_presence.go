package store

import (
	"context"
	"encoding/json"
	"time"
)

const WorkerPresenceWindow = 15 * time.Second

type WorkerPresenceState string

const (
	WorkerUnknown WorkerPresenceState = "unknown"
	WorkerOnline  WorkerPresenceState = "online"
	WorkerOffline WorkerPresenceState = "offline"
)

// WorkerPresence is a contact observation, independent of execution permission.
type WorkerPresence struct {
	State      WorkerPresenceState `json:"state"`
	LastSeenAt *time.Time          `json:"last_seen_at"`
	ObservedAt time.Time           `json:"observed_at"`
}

func ObserveWorkerPresence(lastSeen *time.Time, now time.Time) WorkerPresence {
	presence := WorkerPresence{State: WorkerUnknown, LastSeenAt: lastSeen, ObservedAt: now}
	if lastSeen != nil {
		presence.State = WorkerOffline
		if now.Sub(*lastSeen) < WorkerPresenceWindow {
			presence.State = WorkerOnline
		}
	}
	return presence
}

func (s *Store) listWorkers(ctx context.Context, projects []string) ([]Worker, error) {
	rows, err := s.pool.Query(ctx, `SELECT w.id,w.name,w.projects,w.labels,w.last_seen_at,
		COALESCE(d.enabled,true),d.capabilities,COALESCE(r.id,''),COALESCE(r.task_id,''),COALESCE(r.status,''),COALESCE(r.project_id,'')
		FROM workers w LEFT JOIN worker_devices d ON d.worker_id=w.id
		LEFT JOIN LATERAL (SELECT id,task_id,status,spec->>'project_id' AS project_id FROM runs WHERE worker_id=w.id
		AND status IN ('running','cancel_requested','reconcile') ORDER BY created_at DESC LIMIT 1) r ON true
		WHERE ($1::text[] IS NULL OR w.projects && $1) ORDER BY w.created_at,w.id`, projects)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	workers := []Worker{}
	now := time.Now().UTC()
	for rows.Next() {
		var worker Worker
		var lastSeen *time.Time
		var capabilities []byte
		var runProject string
		if err = rows.Scan(&worker.ID, &worker.Name, &worker.Projects, &worker.Labels, &lastSeen,
			&worker.Enabled, &capabilities, &worker.CurrentRunID, &worker.CurrentTaskID, &worker.CurrentRunStatus, &runProject); err != nil {
			return nil, err
		}
		presence := ObserveWorkerPresence(lastSeen, now)
		worker.Presence = &presence
		worker.Occupied = worker.CurrentRunID != ""
		worker.Capabilities = []WorkerCapability{}
		if len(capabilities) > 0 {
			if err = json.Unmarshal(capabilities, &worker.Capabilities); err != nil {
				return nil, err
			}
		}
		if projects != nil {
			allowed := make(map[string]bool, len(projects))
			for _, project := range projects {
				allowed[project] = true
			}
			visible := []string{}
			for _, project := range worker.Projects {
				if allowed[project] {
					visible = append(visible, project)
				}
			}
			worker.Projects = visible
			visibleCapabilities := []WorkerCapability{}
			for _, capability := range worker.Capabilities {
				if allowed[capability.ProjectID] {
					visibleCapabilities = append(visibleCapabilities, capability)
				}
			}
			worker.Capabilities = visibleCapabilities
			// Occupancy is machine observation; private Run identities stay scoped.
			if !allowed[runProject] {
				worker.CurrentRunID, worker.CurrentTaskID, worker.CurrentRunStatus = "", "", ""
			}

		}
		workers = append(workers, worker)
	}
	return workers, rows.Err()
}
