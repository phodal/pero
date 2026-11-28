package httpapi

import (
	"context"
	"errors"

	"github.com/phodal/pero/server/internal/paperdomain"
	"github.com/phodal/pero/server/internal/resourceref"
	"github.com/phodal/pero/server/internal/store"
)

// PersistedPaper is the production Paper owner. A nil database fails closed.
type PersistedPaper struct {
	DB *store.Store
}

func (p *PersistedPaper) Paper(owner, project, id string) (PaperRecord, bool) {
	if p == nil || p.DB == nil {
		return PaperRecord{}, false
	}
	record, err := p.DB.PaperIdentity(context.Background(), owner, project, id)
	if err != nil {
		return PaperRecord{}, false
	}
	return PaperRecord{
		Resource: resourceref.Qualified{
			OwnerHost: record.OwnerHost, SharedProject: record.Project, LocalProject: record.LocalProject,
			App: paperdomain.App, AppInstance: record.AppInstance, AppVersion: record.AppVersion,
			Kind: "paper", ID: record.ID, Revision: record.Revision, Class: resourceref.ClassImmutable,
		},
		MediaType: record.MediaType, Body: record.Body, Enabled: true, Granted: true, Available: true,
	}, true
}

func (p *PersistedPaper) ImportPDF(project string, body []byte, digest string) (string, string, bool) {
	if p == nil || p.DB == nil {
		return "", "", false
	}
	existing, err := p.DB.PaperByDigest(context.Background(), project, digest)
	var prior *paperdomain.Record
	if err == nil {
		prior = &existing
	} else if !errors.Is(err, store.ErrNotFound) {
		return "", "", false
	}
	minted, err := paperdomain.MintID()
	if err != nil {
		return "", "", false
	}
	record, _, err := paperdomain.Place(project, body, digest, prior, minted)
	if err != nil {
		return "", "", false
	}
	if prior != nil && prior.ID == record.ID {
		return record.ID, record.Revision, true
	}
	if err = p.DB.SavePaper(context.Background(), record); err != nil {
		if !errors.Is(err, store.ErrConflict) {
			return "", "", false
		}
		again, readErr := p.DB.PaperByDigest(context.Background(), project, digest)
		if readErr != nil {
			return "", "", false
		}
		return again.ID, again.Revision, true
	}
	return record.ID, record.Revision, true
}
