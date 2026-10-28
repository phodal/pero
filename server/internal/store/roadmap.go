package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

type RoadmapItem struct {
	ID, ParentID, Title, Text string
	Checked                   bool
	Line                      int
	Depth                     int
	Headings, Tags            []string
}
type RoadmapSnapshot struct {
	RepositoryID, Repository, Path, CommitSHA, BlobSHA string
	Items                                              []RoadmapItem
	Partial                                            bool
}
type RoadmapChanges struct{ Imported, Updated, Missing int }

func roadmapSource(snapshot RoadmapSnapshot, item RoadmapItem) *Source {
	goal := struct {
		ID, ParentID, Title, Text string
		Checked                   bool
		Headings, Tags            []string
	}{item.ID, item.ParentID, item.Title, item.Text, item.Checked, item.Headings, item.Tags}
	data, _ := json.Marshal(goal)
	hash := sha256.Sum256(data)
	state := "open"
	if item.Checked {
		state = "closed"
	}
	segments := strings.Split(snapshot.Path, "/")
	for i := range segments {
		segments[i] = url.PathEscape(segments[i])
	}
	return &Source{Kind: "roadmap", Repository: snapshot.Repository, RepositoryID: snapshot.RepositoryID, Path: snapshot.Path, ItemID: item.ID, ParentItemID: item.ParentID, Line: item.Line, Depth: item.Depth, Headings: item.Headings, Tags: item.Tags, CommitSHA: snapshot.CommitSHA, BlobSHA: snapshot.BlobSHA, State: state, Revision: hex.EncodeToString(hash[:]), URL: "https://github.com/" + snapshot.Repository + "/blob/" + snapshot.CommitSHA + "/" + strings.Join(segments, "/") + "#L" + strconv.Itoa(item.Line)}
}

// One complete file is one transaction. A partial parse can import valid items,
// but cannot manufacture removals for omitted or ambiguous source items.
func (s *Store) SyncRoadmap(ctx context.Context, config GitHubRepository, snapshot RoadmapSnapshot) (RoadmapChanges, error) {
	changes := RoadmapChanges{}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return changes, err
	}
	defer tx.Rollback(ctx)
	// One configured repository binding selects one path. Serialize path replacements too.
	key := config.ProjectID + ":" + snapshot.RepositoryID
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "pero:roadmap:"+key); err != nil {
		return changes, err
	}
	rows, err := tx.Query(ctx, `SELECT item_id,task_id,latest->>'revision',latest->>'state' FROM roadmap_items WHERE project_id=$1 AND repository_id=$2 AND path=$3`, config.ProjectID, snapshot.RepositoryID, snapshot.Path)
	if err != nil {
		return changes, err
	}
	ids := map[string]string{}
	revisions := map[string]string{}
	states := map[string]string{}
	for rows.Next() {
		var item, id, revision, state string
		if err = rows.Scan(&item, &id, &revision, &state); err != nil {
			rows.Close()
			return changes, err
		}
		ids[item] = id
		revisions[item] = revision
		states[item] = state
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return changes, err
	}
	seen := map[string]bool{}
	for _, item := range snapshot.Items {
		if seen[item.ID] {
			return changes, fmt.Errorf("ambiguous roadmap item identity")
		}
		seen[item.ID] = true
		if ids[item.ID] == "" {
			ids[item.ID] = newID("task")
		}
	}
	for _, item := range snapshot.Items {
		source := roadmapSource(snapshot, item)
		parent := ""
		if item.ParentID != "" {
			parent = ids[item.ParentID]
			if parent == "" {
				return changes, fmt.Errorf("roadmap parent identity missing")
			}
		}
		spec := Spec{Title: item.Title, Prompt: item.Text, Acceptance: config.Acceptance, ProjectID: config.ProjectID, WorkspaceKey: config.WorkspaceKey, AgentID: config.AgentID, Source: source, Tags: item.Tags, ParentTaskID: parent}
		encoded, _ := json.Marshal(spec)
		id := ids[item.ID]
		result, err := tx.Exec(ctx, `INSERT INTO tasks(id,spec) VALUES($1,$2) ON CONFLICT(id) DO NOTHING`, id, encoded)
		if err != nil {
			return changes, err
		}
		fresh := result.RowsAffected() == 1
		if fresh {
			changes.Imported++
		}
		if err = publishPublicSource(ctx, tx, config, id, spec); err != nil {
			return changes, err
		}
		var current string
		var claimed *string
		if err = tx.QueryRow(ctx, `SELECT COALESCE(current_run_id,''),claimed_by_client_id FROM tasks WHERE id=$1 FOR UPDATE`, id).Scan(&current, &claimed); err != nil {
			return changes, err
		}
		if !fresh && (revisions[item.ID] != source.Revision || states[item.ID] == "missing") {
			changes.Updated++
		}
		if current == "" && claimed == nil {
			if _, err = tx.Exec(ctx, `UPDATE tasks SET spec=$2 WHERE id=$1`, id, encoded); err != nil {
				return changes, err
			}
		}
		latest, _ := json.Marshal(source)
		if _, err = tx.Exec(ctx, `INSERT INTO roadmap_items(project_id,repository_id,path,item_id,task_id,latest) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id,repository_id,path,item_id) DO UPDATE SET latest=EXCLUDED.latest`, config.ProjectID, snapshot.RepositoryID, snapshot.Path, item.ID, id, latest); err != nil {
			return changes, err
		}
		payload, _ := json.Marshal(struct {
			Source      *Source `json:"source"`
			Title, Text string
		}{source, item.Title, item.Text})
		if _, err = tx.Exec(ctx, `INSERT INTO roadmap_versions(project_id,repository_id,path,item_id,revision,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, config.ProjectID, snapshot.RepositoryID, snapshot.Path, item.ID, source.Revision, payload); err != nil {
			return changes, err
		}
		if source.State == "closed" && current != "" {
			if _, err = tx.Exec(ctx, `UPDATE runs SET status='cancelled',summary='Roadmap item completed before execution' WHERE id=$1 AND status='queued'`, current); err != nil {
				return changes, err
			}
		}
	}
	if !snapshot.Partial {
		items := []string{}
		for _, item := range snapshot.Items {
			items = append(items, item.ID)
		}
		// Lock Tasks before changing latest metadata, matching claim/dispatch order.
		rows, err = tx.Query(ctx, `SELECT t.id,r.latest FROM roadmap_items r JOIN tasks t ON t.id=r.task_id WHERE r.project_id=$1 AND r.repository_id=$2 AND (r.path<>$3 OR NOT(r.item_id=ANY($4))) FOR UPDATE OF t`, config.ProjectID, snapshot.RepositoryID, snapshot.Path, items)
		if err != nil {
			return changes, err
		}
		type absent struct {
			id     string
			source Source
		}
		missing := []absent{}
		for rows.Next() {
			var row absent
			var data []byte
			if err = rows.Scan(&row.id, &data); err != nil {
				rows.Close()
				return changes, err
			}
			if err = json.Unmarshal(data, &row.source); err != nil {
				rows.Close()
				return changes, err
			}
			if row.source.State != "missing" {
				missing = append(missing, row)
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return changes, err
		}
		for _, row := range missing {
			row.source.State = "missing"
			// Keep the last known goal's navigable URL and blob together. The
			// absence observation has its own commit rather than relabelling it.
			row.source.MissingAtCommit = snapshot.CommitSHA
			latest, _ := json.Marshal(row.source)
			if _, err = tx.Exec(ctx, `UPDATE roadmap_items SET latest=$2 WHERE task_id=$1`, row.id, latest); err != nil {
				return changes, err
			}
			if _, err = tx.Exec(ctx, `UPDATE runs SET status='cancelled',summary='Roadmap item removed before execution' WHERE id=(SELECT current_run_id FROM tasks WHERE id=$1) AND status='queued'`, row.id); err != nil {
				return changes, err
			}
			changes.Missing++
		}
	}
	return changes, tx.Commit(ctx)
}
