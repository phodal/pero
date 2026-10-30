// Adapted from phodal/point@edff76d7dd39b2900cff707af1896fe8ff9fd2dc; see ../../SOURCE_REFERENCES.md.
package kubernetes

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/phodal/pero/server/internal/environments/model"
)

var ErrAlreadyExists = errors.New("Kubernetes resource already exists")

// ClaimWriter is the only mutation this package performs: creating and deleting
// SandboxClaims. Implementations use a client supplied by the Host.
type ClaimWriter interface {
	CreateClaim(ctx context.Context, namespace string, claim map[string]any) (Object, error)
	// DeleteClaim removes the claim only if it still has this UID, with
	// foreground propagation so its Sandbox and Pod terminate before it vanishes.
	DeleteClaim(ctx context.Context, key Key, uid string) error
}

type HTTPWriter struct {
	base   string
	client *http.Client
}

func NewHTTPWriter(base string, client *http.Client) (*HTTPWriter, error) {
	origin, copy, err := checkedClient(base, client)
	if err != nil {
		return nil, err
	}
	return &HTTPWriter{base: origin, client: copy}, nil
}

func (w *HTTPWriter) CreateClaim(ctx context.Context, namespace string, claim map[string]any) (Object, error) {
	path, err := resourcePath(Key{Kind: "kubernetes.sandboxclaim", Namespace: namespace, Name: "x"})
	if err != nil {
		return Object{}, err
	}
	path = path[:len(path)-len("/x")]
	body, err := json.Marshal(claim)
	if err != nil {
		return Object{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, w.base+path, bytes.NewReader(body))
	if err != nil {
		return Object{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := w.client.Do(request)
	if err != nil {
		return Object{}, err
	}
	defer response.Body.Close()
	switch response.StatusCode {
	case http.StatusCreated, http.StatusOK, http.StatusAccepted:
	case http.StatusConflict:
		return Object{}, ErrAlreadyExists
	default:
		return Object{}, fmt.Errorf("Kubernetes POST %s: HTTP %d", path, response.StatusCode)
	}
	const limit = 2 << 20
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return Object{}, err
	}
	if len(data) > limit {
		return Object{}, fmt.Errorf("Kubernetes create response exceeds byte limit")
	}
	var object Object
	return object, json.Unmarshal(data, &object)
}

func (w *HTTPWriter) DeleteClaim(ctx context.Context, key Key, uid string) error {
	if !model.ValidText(uid) {
		return model.ErrInvalid
	}
	key.Kind = "kubernetes.sandboxclaim"
	path, err := resourcePath(key)
	if err != nil {
		return err
	}
	options, _ := json.Marshal(map[string]any{"propagationPolicy": "Foreground", "preconditions": map[string]string{"uid": uid}})
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, w.base+path, bytes.NewReader(options))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := w.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	switch response.StatusCode {
	case http.StatusOK, http.StatusAccepted:
		return nil
	case http.StatusNotFound:
		return ErrNotFound
	case http.StatusConflict:
		return fmt.Errorf("claim identity changed: %w", errIdentity)
	default:
		return fmt.Errorf("Kubernetes DELETE %s: HTTP %d", path, response.StatusCode)
	}
}
