// Adapted from phodal/point@edff76d7dd39b2900cff707af1896fe8ff9fd2dc; see ../../SOURCE_REFERENCES.md.
// Package kubernetes attaches to existing Pods and Agent Sandbox v1beta1
// resources. Observation and attachment are read-only. Creating or deleting
// workloads is limited to SandboxClaims through ClaimOwner (claim.go); neither
// path issues Use grants.
package kubernetes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

const SandboxAPI = "agents.x-k8s.io/v1beta1"
const ClaimAPI = "extensions.agents.x-k8s.io/v1beta1"
const podNameAnnotation = "agents.x-k8s.io/pod-name"

var ErrNotFound = errors.New("Kubernetes resource not found")

type Key struct{ Kind, Namespace, Name string }
type Reader interface {
	Get(context.Context, Key) (Object, error)
}

type Metadata struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	UID               string `json:"uid"`
	ResourceVersion   string `json:"resourceVersion"`
	Generation        int64  `json:"generation"`
	DeletionTimestamp string `json:"deletionTimestamp"`
	// PodName is the only annotation projected: the Pod a warm-pool adoption
	// kept. All other annotations are discarded while decoding.
	PodName string `json:"-"`
	// Labels retains only the module's request fingerprint for claim adoption.
	Labels          map[string]string `json:"labels,omitempty"`
	OwnerReferences []struct {
		APIVersion string `json:"apiVersion"`
		Kind       string `json:"kind"`
		Name       string `json:"name"`
		UID        string `json:"uid"`
		Controller bool   `json:"controller"`
	} `json:"ownerReferences"`
}

func (m *Metadata) UnmarshalJSON(data []byte) error {
	type plain Metadata
	var decoded struct {
		plain
		Annotations map[string]string `json:"annotations"`
	}
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*m = Metadata(decoded.plain)
	m.PodName = decoded.Annotations[podNameAnnotation]
	if digest, ok := m.Labels[labelPrefix+"spec"]; ok {
		m.Labels = map[string]string{labelPrefix + "spec": digest}
	} else {
		m.Labels = nil
	}
	return nil
}

// Object projects only identity and lifecycle facts. Pod env, Secret references,
// kubeconfig, annotations, credentials, commands and logs are never exported.
type Object struct {
	APIVersion string   `json:"apiVersion"`
	Kind       string   `json:"kind"`
	Metadata   Metadata `json:"metadata"`
	Spec       struct {
		OperatingMode    string `json:"operatingMode"`
		ShutdownTime     string `json:"shutdownTime"`
		RuntimeClassName string `json:"runtimeClassName"`
		WarmPoolRef      struct {
			Name string `json:"name"`
		} `json:"warmPoolRef"`
		Lifecycle struct {
			ShutdownTime   string `json:"shutdownTime"`
			ShutdownPolicy string `json:"shutdownPolicy"`
		} `json:"lifecycle"`
	} `json:"spec"`
	Status struct {
		Phase   string `json:"phase"`
		Sandbox struct {
			Name string `json:"name"`
		} `json:"sandbox"`
		Conditions []struct {
			Type               string `json:"type"`
			Status             string `json:"status"`
			Reason             string `json:"reason"`
			ObservedGeneration int64  `json:"observedGeneration"`
		} `json:"conditions"`
		ContainerStatuses []struct {
			Name         string `json:"name"`
			ContainerID  string `json:"containerID"`
			ImageID      string `json:"imageID"`
			RestartCount int64  `json:"restartCount"`
			Ready        bool   `json:"ready"`
			State        struct {
				Running *json.RawMessage `json:"running"`
			} `json:"state"`
		} `json:"containerStatuses"`
	} `json:"status"`
}

var dnsName = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$`)

func resourcePath(key Key) (string, error) {
	if !dnsName.MatchString(key.Namespace) || !dnsName.MatchString(key.Name) || strings.Contains(key.Namespace, ".") || len(key.Namespace) > 63 {
		return "", fmt.Errorf("invalid Kubernetes resource key")
	}
	switch key.Kind {
	case "kubernetes.pod":
		return "/api/v1/namespaces/" + key.Namespace + "/pods/" + key.Name, nil
	case "kubernetes.sandbox":
		return "/apis/" + SandboxAPI + "/namespaces/" + key.Namespace + "/sandboxes/" + key.Name, nil
	case "kubernetes.sandboxclaim":
		return "/apis/" + ClaimAPI + "/namespaces/" + key.Namespace + "/sandboxclaims/" + key.Name, nil
	default:
		return "", fmt.Errorf("unsupported Kubernetes resource kind %q", key.Kind)
	}
}

type HTTPReader struct {
	base   string
	client *http.Client
}

// NewHTTPReader accepts an authenticated client supplied by its Host. It never
// reads ambient kubeconfig or ServiceAccount files. HTTP is limited to loopback
// proxies; redirects cannot forward the supplied credentials to another target.
func NewHTTPReader(base string, client *http.Client) (*HTTPReader, error) {
	origin, copy, err := checkedClient(base, client)
	if err != nil {
		return nil, err
	}
	return &HTTPReader{base: origin, client: copy}, nil
}

func checkedClient(base string, client *http.Client) (string, *http.Client, error) {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" && u.Path != "/" {
		return "", nil, fmt.Errorf("invalid Kubernetes API origin")
	}
	loopback := strings.EqualFold(u.Hostname(), "localhost")
	if ip := net.ParseIP(u.Hostname()); ip != nil {
		loopback = ip.IsLoopback()
	}
	if u.Scheme != "https" && (u.Scheme != "http" || !loopback) {
		return "", nil, fmt.Errorf("Kubernetes API requires HTTPS or a loopback proxy")
	}
	if client == nil {
		return "", nil, fmt.Errorf("Kubernetes API client is required")
	}
	copy := *client
	copy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return strings.TrimSuffix(base, "/"), &copy, nil
}

func (r *HTTPReader) Get(ctx context.Context, key Key) (Object, error) {
	path, err := resourcePath(key)
	if err != nil {
		return Object{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, r.base+path, nil)
	if err != nil {
		return Object{}, err
	}
	response, err := r.client.Do(request)
	if err != nil {
		return Object{}, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return Object{}, ErrNotFound
	}
	if response.StatusCode != http.StatusOK {
		return Object{}, fmt.Errorf("Kubernetes GET %s: HTTP %d", path, response.StatusCode)
	}
	const limit = 2 << 20
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return Object{}, err
	}
	if len(data) > limit {
		return Object{}, fmt.Errorf("Kubernetes observation exceeds byte limit")
	}
	var object Object
	if err := json.Unmarshal(data, &object); err != nil {
		return object, err
	}
	return object, nil
}
