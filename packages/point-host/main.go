// Point's Project and calendar domains, hosted as private Pero Host operations.
// It owns no App installation, Agent runtime, scheduler or Session store.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/phodal/point/go/harness/projects"
	"github.com/phodal/point/go/harness/storage"
)

type Request struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers"`
	Body    json.RawMessage   `json:"body,omitempty"`
}
type Response struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    any               `json:"body"`
}

func (r Request) header(name string) string {
	for key, value := range r.Headers {
		if strings.EqualFold(key, name) {
			return value
		}
	}
	return ""
}
func reply(status int, body any) Response {
	return Response{Status: status, Headers: map[string]string{"Content-Type": "application/json", "Cache-Control": "no-store"}, Body: body}
}
func rejected(err error) Response {
	status, code := 500, "project/internal"
	switch {
	case errors.Is(err, projects.ErrInvalid):
		status, code = 400, "project/invalid-input"
	case errors.Is(err, projects.ErrNotFound):
		status, code = 404, "project/not-found"
	case errors.Is(err, projects.ErrConflict):
		status, code = 409, "project/revision-conflict"
	case errors.Is(err, projects.ErrRevoked):
		status, code = 403, "project/access-revoked"
	}
	return reply(status, map[string]string{"code": code, "error": code})
}
func decode(data []byte, out any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("trailing JSON")
	}
	return nil
}
func command(r Request) (uint64, string, error) {
	op := strings.TrimSpace(r.header("Idempotency-Key"))
	if len(op) < 8 || len(op) > 100 {
		return 0, "", projects.ErrInvalid
	}
	revision, err := strconv.ParseUint(strings.Trim(r.header("If-Match"), "\""), 10, 64)
	if err != nil {
		return 0, "", projects.ErrInvalid
	}
	return revision, op, nil
}
func handle(ctx context.Context, store *projects.Store, workspaceID string, r Request) Response {
	target, err := url.ParseRequestURI(r.Path)
	if err != nil || target.IsAbs() {
		return rejected(projects.ErrInvalid)
	}
	parts := strings.Split(strings.Trim(target.Path, "/"), "/")
	if len(parts) < 2 || parts[0] != "api" || parts[1] != "projects" {
		return reply(501, map[string]string{"code": "point-api/not-implemented"})
	}
	if len(parts) == 2 {
		if r.Method == "GET" {
			return reply(200, struct {
				Items []projects.Project `json:"items"`
				Trash any                `json:"trash"`
			}{store.List(), store.ListTrash()})
		}
		if r.Method != "POST" {
			return reply(405, map[string]string{"code": "method-not-allowed"})
		}
		var input struct {
			Title        string            `json:"title"`
			TypeID       string            `json:"typeId"`
			Brief        string            `json:"brief"`
			Goal         string            `json:"goal"`
			Instructions string            `json:"instructions"`
			WorkspaceID  string            `json:"workspaceId"`
			Repositories []json.RawMessage `json:"repositories"`
		}
		op := strings.TrimSpace(r.header("Idempotency-Key"))
		if len(r.Body) > 65536 || decode(r.Body, &input) != nil || len(op) < 8 || len(op) > 100 || input.WorkspaceID != "" && input.WorkspaceID != workspaceID {
			return rejected(projects.ErrInvalid)
		}
		if len(strings.TrimSpace(input.Title)) == 0 || len(input.Title) > 160 || len(input.Brief) > 12000 || len(input.Goal) > 4000 || len(input.Instructions) > 8000 {
			return rejected(projects.ErrInvalid)
		}
		if len(input.Repositories) > 0 {
			return reply(501, map[string]string{"code": "project/repository-resolver-required"})
		}
		digest := strings.TrimPrefix(projects.Digest([]byte("create:"+op)), "sha256:")
		id := "prj_" + digest[:24]
		version := 0
		for _, pack := range projects.AvailableTypes() {
			if pack.TypeID == input.TypeID && pack.TypeVersion > version {
				version = pack.TypeVersion
			}
		}
		project := projects.Project{ID: id, Title: strings.TrimSpace(input.Title), TypeID: input.TypeID, TypeVersion: version, Brief: strings.TrimSpace(input.Brief), Goal: input.Goal, Instructions: input.Instructions, WorkspaceID: input.WorkspaceID, Repositories: []projects.RepositoryRef{}}
		if pack, found := projects.LookupType(input.TypeID, version); found {
			project.SchemaDigest = pack.SchemaDigest
		}
		if _, err = store.Append(ctx, id, 0, op, "project.created", project); err != nil {
			return rejected(err)
		}
		state, _ := store.Get(id)
		return reply(201, state)
	}
	if parts[2] == "types" && len(parts) == 3 && r.Method == "GET" {
		return reply(200, map[string]any{"items": projects.AvailableTypes()})
	}
	id := parts[2]
	state, found := store.Get(id)
	if !found {
		return rejected(projects.ErrNotFound)
	}
	if len(parts) == 3 && r.Method == "GET" {
		out := reply(200, state)
		out.Headers["ETag"] = fmt.Sprintf("\"%d\"", state.Project.Revision)
		return out
	}
	if len(parts) == 4 && parts[3] == "hub" && r.Method == "GET" {
		if _, shared := store.Replica(id); shared {
			return reply(503, map[string]string{"code": "hub/unavailable"})
		}
		return reply(200, struct {
			Connected  bool   `json:"connected"`
			Connection any    `json:"connection"`
			Shared     bool   `json:"shared"`
			HostID     string `json:"hostId"`
		}{HostID: store.HostID()})
	}
	if len(parts) == 5 && parts[3] == "revisions" && r.Method == "GET" {
		revision, err := strconv.ParseUint(parts[4], 10, 64)
		if err != nil {
			return rejected(projects.ErrInvalid)
		}
		frozen, err := store.GetAtRevision(id, revision)
		if err != nil {
			return rejected(err)
		}
		return reply(200, frozen)
	}
	if len(parts) == 4 && parts[3] == "context" && r.Method == "POST" {
		var input struct {
			Brief        string `json:"brief"`
			Goal         string `json:"goal"`
			Instructions string `json:"instructions"`
		}
		revision, op, err := command(r)
		if err != nil || len(r.Body) > 32768 || decode(r.Body, &input) != nil || len(input.Brief) > 12000 || len(input.Goal) > 4000 || len(input.Instructions) > 8000 {
			return rejected(projects.ErrInvalid)
		}
		if _, err = store.Append(ctx, id, revision, op, "project.context", input); err != nil {
			return rejected(err)
		}
		state, _ := store.Get(id)
		return reply(200, state)
	}
	return reply(501, map[string]string{"code": "point-api/not-implemented"})
}
func execute(root, workspaceID string, r Request) (Response, error) {
	if r.Path == automationCalendarPath {
		return automationCalendar(r), nil
	}
	ctx := context.Background()
	backend, err := storage.NewJSONBackend(root)
	if err != nil {
		return Response{}, err
	}
	defer backend.Close(ctx)
	registry := storage.NewBackendRegistry()
	if _, err = registry.Register("json", backend); err != nil {
		return Response{}, err
	}
	facility, err := storage.NewDomainFacility(registry, storage.DomainConfig{Backend: "json"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		return Response{}, err
	}
	defer facility.Close(ctx)
	store, err := projects.Open(ctx, facility)
	if err != nil {
		return Response{}, err
	}
	defer store.Close(ctx)
	return handle(ctx, store, workspaceID, r), nil
}
func main() {
	root := flag.String("root", "", "Host-owned Project data root")
	workspace := flag.String("workspace-id", "", "Registered Host workspace identity")
	flag.Parse()
	body, err := io.ReadAll(io.LimitReader(os.Stdin, 1048577))
	if err != nil || len(body) > 1048576 {
		fmt.Fprintln(os.Stderr, "request exceeds 1 MiB")
		os.Exit(1)
	}
	var request Request
	if err = decode(body, &request); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if request.Path != automationCalendarPath && !filepath.IsAbs(*root) {
		fmt.Fprintln(os.Stderr, "absolute Host Project data root required")
		os.Exit(1)
	}
	result, err := execute(*root, *workspace, request)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err = json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
