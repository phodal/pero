package store

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/phodal/pero/server/internal/artifacts"
)

// DeliveryManifest links execution and evidence. Execution, approval and
// reconciliation still belong to the Run or Campaign that supplied the record.
type DeliveryManifest struct {
	Title          string            `json:"title"`
	BaseSHA        string            `json:"base_sha"`
	CampaignID     string            `json:"campaign_id,omitempty"`
	Analysis       *RunRef           `json:"analysis,omitempty"`
	AnalysisRetry  *RunRef           `json:"analysis_retry,omitempty"`
	Implementation *RunRef           `json:"implementation,omitempty"`
	Verification   *RunRef           `json:"verification,omitempty"`
	Proposal       *DeliveryEvidence `json:"proposal,omitempty"`
	Candidate      *DeliveryEvidence `json:"candidate,omitempty"`
	Approval       *DeliveryEvidence `json:"approval,omitempty"`
	Report         *DeliveryEvidence `json:"report,omitempty"`
}

// DeliveryEvidence identifies an entry in the committed manifest of its Run.
type DeliveryEvidence struct {
	ExportID string `json:"export_id"`
	FileID   string `json:"file_id"`
	SHA256   string `json:"sha256"`
}

type DeliveryRecord struct {
	ID        string `json:"id"`
	ProjectID string `json:"project_id"`
	DeliveryManifest
	CreatedAt time.Time `json:"created_at"`
}

type DeliveryView struct {
	DeliveryRecord
	AnalysisRun       *DeliveryRunView `json:"analysis_run,omitempty"`
	AnalysisRetryRun  *DeliveryRunView `json:"analysis_retry_run,omitempty"`
	ImplementationRun *DeliveryRunView `json:"implementation_run,omitempty"`
	VerificationRun   *DeliveryRunView `json:"verification_run,omitempty"`
	Campaign          *CampaignRecord  `json:"campaign,omitempty"`
}

type DeliveryRunView struct {
	RunRef
	AgentID        string             `json:"agent_id"`
	WorkspaceKey   string             `json:"workspace_key"`
	WorkerID       string             `json:"worker_id,omitempty"`
	Status         string             `json:"status"`
	Reconciliation *RunReconciliation `json:"reconciliation,omitempty"`
}

type DeliveryRunChoice struct {
	RunRef
	Title      string `json:"title"`
	WorkerName string `json:"worker_name,omitempty"`
}

var ErrDeliveryInput = errors.New("invalid delivery manifest or evidence binding")
var deliveryKey = regexp.MustCompile("^[a-zA-Z0-9_-]{1,128}$")
var deliveryBaseSHA = regexp.MustCompile("^([a-f0-9]{40}|[a-f0-9]{64})$")
var deliveryDigest = regexp.MustCompile("^[a-f0-9]{64}$")

type deliveryRunLink struct {
	ref  *RunRef
	view **DeliveryRunView
}

type deliveryEvidenceLink struct {
	ref      *RunRef
	evidence *DeliveryEvidence
}

func (m DeliveryManifest) evidence(kind string) deliveryEvidenceLink {
	switch kind {
	case "proposal":
		return deliveryEvidenceLink{m.Analysis, m.Proposal}
	case "candidate":
		return deliveryEvidenceLink{m.Implementation, m.Candidate}
	case "approval":
		return deliveryEvidenceLink{m.Implementation, m.Approval}
	case "report":
		return deliveryEvidenceLink{m.Verification, m.Report}
	default:
		return deliveryEvidenceLink{}
	}
}

var deliveryEvidenceKinds = [...]string{"proposal", "candidate", "approval", "report"}

func (m DeliveryManifest) validate() error {
	if strings.TrimSpace(m.Title) == "" || utf8.RuneCountInString(m.Title) > 240 || strings.ContainsRune(m.Title, 0) ||
		!deliveryBaseSHA.MatchString(m.BaseSHA) || (m.Analysis == nil && m.CampaignID == "") ||
		(m.CampaignID != "" && !deliveryKey.MatchString(m.CampaignID)) {
		return ErrDeliveryInput
	}
	if m.AnalysisRetry != nil && (m.Analysis == nil || m.Analysis.TaskID != m.AnalysisRetry.TaskID || m.AnalysisRetry.Generation <= m.Analysis.Generation) {
		return ErrDeliveryInput
	}
	seen := map[string]bool{}
	for _, run := range []*RunRef{m.Analysis, m.AnalysisRetry, m.Implementation, m.Verification} {
		if run == nil {
			continue
		}
		if run.Generation < 1 || !deliveryKey.MatchString(run.TaskID) || !deliveryKey.MatchString(run.RunID) || seen[run.RunID] {
			return ErrDeliveryInput
		}
		seen[run.RunID] = true
	}
	for _, kind := range deliveryEvidenceKinds {
		link := m.evidence(kind)
		e := link.evidence
		if e != nil && (link.ref == nil || e.ExportID == "" || len(e.ExportID) > 128 ||
			!deliveryKey.MatchString(e.FileID) || !deliveryDigest.MatchString(e.SHA256)) {
			return ErrDeliveryInput
		}
	}
	return nil
}

// validateAppend preserves the published baseline and evidence.
func (m DeliveryManifest) validateAppend(prior DeliveryManifest) error {
	if m.Title != prior.Title || m.BaseSHA != prior.BaseSHA ||
		(prior.CampaignID != "" && prior.CampaignID != m.CampaignID) {
		return ErrConflict
	}
	for _, pair := range [][2]*RunRef{{prior.Analysis, m.Analysis}, {prior.AnalysisRetry, m.AnalysisRetry}, {prior.Implementation, m.Implementation}, {prior.Verification, m.Verification}} {
		if pair[0] != nil && (pair[1] == nil || *pair[0] != *pair[1]) {
			return ErrConflict
		}
	}
	for _, kind := range deliveryEvidenceKinds {
		old, next := prior.evidence(kind).evidence, m.evidence(kind).evidence
		if old != nil && (next == nil || *old != *next) {
			return ErrConflict
		}
	}
	return nil
}

const deliveryColumns = "id,project_id,manifest,created_at"

func readDelivery(row pgx.Row) (DeliveryRecord, error) {
	var result DeliveryRecord
	var raw []byte
	if err := row.Scan(&result.ID, &result.ProjectID, &raw, &result.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DeliveryRecord{}, ErrNotFound
		}
		return DeliveryRecord{}, err
	}
	return result, json.Unmarshal(raw, &result.DeliveryManifest)
}

type DeliveryPage struct {
	Deliveries []DeliveryRecord `json:"deliveries"`
	NextCursor string           `json:"next_cursor,omitempty"`
}

func (s *Store) ClientDeliveries(ctx context.Context, client *Client, project, before string) (DeliveryPage, error) {
	if !slices.Contains(client.Projects, project) {
		return DeliveryPage{}, ErrNotFound
	}
	const pageSize = 50
	rows, err := s.pool.Query(ctx, "SELECT "+deliveryColumns+` FROM project_deliveries
		WHERE project_id=$1 AND ($2='' OR (created_at,id)<(
			SELECT created_at,id FROM project_deliveries WHERE project_id=$1 AND id=$2))
		ORDER BY created_at DESC,id DESC LIMIT $3`, project, before, pageSize+1)
	if err != nil {
		return DeliveryPage{}, err
	}
	defer rows.Close()
	page := DeliveryPage{Deliveries: []DeliveryRecord{}}
	for rows.Next() {
		if len(page.Deliveries) == pageSize {
			page.NextCursor = page.Deliveries[pageSize-1].ID
			break
		}
		entry, err := readDelivery(rows)
		if err != nil {
			return DeliveryPage{}, err
		}
		page.Deliveries = append(page.Deliveries, entry)
	}
	return page, rows.Err()
}

// ClientDeliveryRunChoices lists bounded recent exact Runs. Earlier generations
// remain available here even when the Task list points at a newer Run.
func (s *Store) ClientDeliveryRunChoices(ctx context.Context, client *Client, project string) ([]DeliveryRunChoice, error) {
	if !slices.Contains(client.Projects, project) {
		return nil, ErrNotFound
	}
	rows, err := s.pool.Query(ctx, `SELECT r.task_id,r.id,r.generation,r.spec->>'title',COALESCE(w.name,'')
		FROM runs r JOIN tasks t ON t.id=r.task_id
		LEFT JOIN workers w ON w.id=COALESCE(r.worker_id,r.target_worker_id)
		WHERE t.spec->>'project_id'=$1 AND r.spec->>'project_id'=$1
		ORDER BY r.created_at DESC,r.id DESC LIMIT 50`, project)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	choices := []DeliveryRunChoice{}
	for rows.Next() {
		var choice DeliveryRunChoice
		if err := rows.Scan(&choice.TaskID, &choice.RunID, &choice.Generation, &choice.Title, &choice.WorkerName); err != nil {
			return nil, err
		}
		choices = append(choices, choice)
	}
	return choices, rows.Err()
}

func (s *Store) clientDelivery(ctx context.Context, client *Client, project, id string) (DeliveryRecord, error) {
	if !slices.Contains(client.Projects, project) {
		return DeliveryRecord{}, ErrNotFound
	}
	return readDelivery(s.pool.QueryRow(ctx, "SELECT "+deliveryColumns+" FROM project_deliveries WHERE project_id=$1 AND id=$2", project, id))
}

func (s *Store) ClientDelivery(ctx context.Context, client *Client, project, id string) (DeliveryView, error) {
	record, err := s.clientDelivery(ctx, client, project, id)
	if err != nil {
		return DeliveryView{}, err
	}
	return s.projectDelivery(ctx, client, record)
}

func (s *Store) projectDelivery(ctx context.Context, client *Client, record DeliveryRecord) (DeliveryView, error) {
	view := DeliveryView{DeliveryRecord: record}
	if record.CampaignID != "" {
		campaign, err := s.ClientCampaign(ctx, client, record.ProjectID, record.CampaignID)
		if err != nil {
			return DeliveryView{}, err
		}
		view.Campaign = &campaign
	}
	for _, link := range []deliveryRunLink{
		{record.Analysis, &view.AnalysisRun}, {record.AnalysisRetry, &view.AnalysisRetryRun}, {record.Implementation, &view.ImplementationRun}, {record.Verification, &view.VerificationRun},
	} {
		if link.ref == nil {
			continue
		}
		run, err := s.ClientProjectRun(ctx, client, record.ProjectID, link.ref.RunID)
		if err != nil {
			return DeliveryView{}, err
		}
		if run.Ref() != *link.ref {
			return DeliveryView{}, ErrNotFound
		}
		worker := run.WorkerID
		if worker == "" {
			worker = run.targetWorkerID
		}
		*link.view = &DeliveryRunView{RunRef: run.Ref(), AgentID: run.Spec.AgentID,
			WorkspaceKey: run.Spec.WorkspaceKey, WorkerID: worker, Status: run.Status, Reconciliation: run.Reconciliation()}
	}
	if view.AnalysisRetryRun != nil && view.AnalysisRun.Reconciliation == nil {
		return DeliveryView{}, ErrConflict
	}
	return view, nil
}

func (s *Store) ClientWriteDelivery(ctx context.Context, client *Client, project, id, request string, manifest DeliveryManifest) (DeliveryRecord, error) {
	if !slices.Contains(client.Projects, project) {
		return DeliveryRecord{}, ErrNotFound
	}
	if err := manifest.validate(); err != nil {
		return DeliveryRecord{}, err
	}
	entry := DeliveryRecord{ID: id, ProjectID: project, DeliveryManifest: manifest}
	if _, err := s.projectDelivery(ctx, client, entry); err != nil {
		return DeliveryRecord{}, err
	}
	for _, kind := range deliveryEvidenceKinds {
		if link := manifest.evidence(kind); link.evidence != nil {
			if _, err := s.resolveDeliveryEvidence(ctx, project, link); err != nil {
				return DeliveryRecord{}, err
			}
		}
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		return DeliveryRecord{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DeliveryRecord{}, err
	}
	defer tx.Rollback(ctx)

	if id != "" {
		prior, err := readDelivery(tx.QueryRow(ctx, "SELECT "+deliveryColumns+
			" FROM project_deliveries WHERE project_id=$1 AND id=$2 AND owner_id=$3 FOR UPDATE", project, id, client.ID))
		if err != nil {
			return DeliveryRecord{}, err
		}
		if err := manifest.validateAppend(prior.DeliveryManifest); err != nil {
			return DeliveryRecord{}, err
		}
		entry, err = readDelivery(tx.QueryRow(ctx, "UPDATE project_deliveries SET manifest=$2 WHERE id=$1 RETURNING "+deliveryColumns, id, raw))
		if err != nil {
			return DeliveryRecord{}, err
		}
		return entry, tx.Commit(ctx)
	}

	if request == "" || len(request) > 128 {
		return DeliveryRecord{}, ErrDeliveryInput
	}
	key := "client:" + client.ID + ":delivery:" + request
	operation := "delivery:" + project
	prior, digest, err := receipt(ctx, tx, key, operation, manifest)
	if err != nil {
		return DeliveryRecord{}, err
	}
	if prior != "" {
		return readDelivery(tx.QueryRow(ctx, "SELECT "+deliveryColumns+" FROM project_deliveries WHERE project_id=$1 AND id=$2", project, prior))
	}
	id = newID("delivery")
	entry, err = readDelivery(tx.QueryRow(ctx, "INSERT INTO project_deliveries(id,project_id,owner_id,manifest) VALUES($1,$2,$3,$4) RETURNING "+deliveryColumns,
		id, project, client.ID, raw))
	if err != nil {
		return DeliveryRecord{}, err
	}
	if err = saveReceipt(ctx, tx, key, operation, digest, id); err != nil {
		return DeliveryRecord{}, err
	}
	return entry, tx.Commit(ctx)
}

func (s *Store) ClientDeliveryEvidence(ctx context.Context, client *Client, project, id, kind string) (artifacts.Entry, error) {
	record, err := s.clientDelivery(ctx, client, project, id)
	if err != nil {
		return artifacts.Entry{}, err
	}
	return s.resolveDeliveryEvidence(ctx, project, record.evidence(kind))
}

func (s *Store) resolveDeliveryEvidence(ctx context.Context, project string, link deliveryEvidenceLink) (artifacts.Entry, error) {
	if link.ref == nil || link.evidence == nil {
		return artifacts.Entry{}, ErrNotFound
	}
	file := link.evidence
	export, err := s.ArtifactExport(ctx, file.ExportID)
	if err != nil {
		return artifacts.Entry{}, err
	}
	source := export.Source
	if export.Phase != artifacts.Committed || export.Manifest == nil || source.ProjectID != project ||
		source.TaskID != link.ref.TaskID || source.RunID != link.ref.RunID || source.Generation != link.ref.Generation {
		return artifacts.Entry{}, ErrNotFound
	}
	for _, entry := range export.Manifest.Entries {
		if entry.ID == file.FileID && entry.SHA256 == "sha256:"+file.SHA256 {
			return entry, nil
		}
	}
	return artifacts.Entry{}, ErrNotFound
}
