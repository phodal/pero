package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/phodal/pero/server/internal/resourceref"
)

// PaperRecord is one Paper revision held by the domain that owns it.
// The control plane does not keep a copy.
type PaperRecord struct {
	Resource  resourceref.Qualified
	MediaType string
	Body      []byte
	Enabled   bool
	Granted   bool
	Available bool
	Cache     *resourceref.Cache
}

// PaperDomain is the scientific source for one read. A miss is not another owner.
type PaperDomain interface {
	Paper(ctx context.Context, owner, project, id string) (PaperRecord, bool)
}

func (a *API) readPaperResource(w http.ResponseWriter, r *http.Request) {
	for _, header := range []string{"X-Pero-Owner", "X-Pero-Backend", "X-Worker-Token", "X-Operator-Token", "X-Forwarded-User", "X-Pero-Path"} {
		if r.Header.Get(header) != "" {
			writeResourceError(w, resourceref.ErrSpoofed)
			return
		}
	}
	project := r.PathValue("project")
	if strings.Contains(project, "..") || strings.ContainsAny(project, "/\\") {
		writeResourceError(w, resourceref.ErrTraversal)
		return
	}
	resource, ok := decodePaper(w, r)
	if !ok {
		return
	}
	if err := resource.Validate(); err != nil {
		writeResourceError(w, err)
		return
	}
	client := clientIdentity(r)
	member := false
	for _, allowed := range client.Projects {
		if allowed == project {
			member = true
		}
	}
	if !member {
		writeResourceError(w, resourceref.ErrRevoked)
		return
	}
	if resource.SharedProject != project {
		writeResourceError(w, resourceref.ErrWrongProject)
		return
	}
	if resource.App != "paper-agent" || resource.Kind != "paper" {
		writeResourceError(w, resourceref.ErrUnsupported)
		return
	}
	if a.paper == nil {
		_, err := resourceref.ReadPaper(resourceref.ReadInput{
			Resource: resource, Project: project, Member: member, AppEnabled: true, OwnerAvailable: false,
		})
		if err == nil || err == resourceref.ErrUngranted {
			err = resourceref.ErrOwnerUnavailable
		}
		writeResourceError(w, err)
		return
	}
	record, found := a.paper.Paper(r.Context(), resource.OwnerHost, project, resource.ID)
	if !found {
		writeResourceError(w, resourceref.ErrMissing)
		return
	}
	if record.Resource.Class != resourceref.ClassImmutable {
		writeResourceError(w, resourceref.ErrNotEvidence)
		return
	}
	if record.Resource.SharedProject != project {
		writeResourceError(w, resourceref.ErrWrongProject)
		return
	}
	if record.Resource.OwnerHost != resource.OwnerHost || record.Resource.LocalProject != resource.LocalProject ||
		record.Resource.App != resource.App || record.Resource.AppInstance != resource.AppInstance ||
		record.Resource.AppVersion != resource.AppVersion || record.Resource.Kind != resource.Kind ||
		record.Resource.ID != resource.ID {
		writeResourceError(w, resourceref.ErrMissing)
		return
	}
	input := resourceref.ReadInput{
		Resource: resource, Project: project, Member: member, AppEnabled: record.Enabled,
		OwnerAvailable: record.Available, Cache: record.Cache,
	}
	if record.Granted {
		input.Grants = []resourceref.Grant{{SharedProject: record.Resource.SharedProject, App: record.Resource.App, ID: record.Resource.ID}}
	}
	if record.Available {
		input.Evidence = &resourceref.Evidence{Digest: record.Resource.Revision, MediaType: record.MediaType, Body: record.Body}
	}
	result, err := resourceref.ReadPaper(input)
	if err != nil {
		writeResourceError(w, err)
		return
	}
	if result.OwnerHost != resource.OwnerHost || result.Revision != resource.Revision || result.Revision != record.Resource.Revision || result.Digest != resource.Revision || result.Provenance != resourceref.DomainProvenance {
		writeResourceError(w, resourceref.ErrStale)
		return
	}
	respond(w, 200, map[string]any{
		"ownerHost": result.OwnerHost, "revision": result.Revision, "digest": result.Digest,
		"mediaType": result.MediaType, "body": base64.StdEncoding.EncodeToString(result.Body),
		"provenance": result.Provenance,
	})
}

func decodePaper(w http.ResponseWriter, r *http.Request) (resourceref.Qualified, bool) {
	var resource resourceref.Qualified
	r.Body = http.MaxBytesReader(w, r.Body, 512*1024)
	body, err := io.ReadAll(r.Body)
	if err != nil || len(bytes.TrimSpace(body)) == 0 || bytes.TrimSpace(body)[0] != '{' {
		respond(w, 400, map[string]string{"error": "expected a bounded JSON object"})
		return resource, false
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		respond(w, 400, map[string]string{"error": "invalid JSON request or request exceeds limit"})
		return resource, false
	}
	for _, key := range []string{"path", "url", "token", "backend", "workerToken", "operatorToken"} {
		if _, present := raw[key]; present {
			writeResourceError(w, resourceref.ErrSpoofed)
			return resource, false
		}
	}
	d := json.NewDecoder(bytes.NewReader(body))
	d.DisallowUnknownFields()
	if err := d.Decode(&resource); err != nil {
		respond(w, 400, map[string]string{"error": "invalid JSON request or request exceeds limit"})
		return resource, false
	}
	return resource, true
}

func writeResourceError(w http.ResponseWriter, err error) {
	status := 400
	switch err {
	case resourceref.ErrRevoked, resourceref.ErrUngranted, resourceref.ErrWrongProject, resourceref.ErrDisabledApp:
		status = 403
	case resourceref.ErrMissing:
		status = 404
	case resourceref.ErrStale, resourceref.ErrOwnerUnavailable:
		status = 409
	}
	respond(w, status, map[string]string{"error": err.Error()})
}
