package kubernetes

import (
	"bytes"
	"encoding/json"
	"net/url"
	"reflect"
	"regexp"
	"strings"

	"github.com/phodal/pero/server/internal/environments/model"
)

// ColdConfig is one fixed, operator-reviewed hostile-Agent recipe. No field is
// supplied by a Task. A RuntimeClass name is a required deployment contract,
// not evidence that its handler is installed or isolates code correctly.
type ColdConfig struct {
	Namespace          string `json:"namespace"`
	ClusterID          string `json:"cluster_id"`
	ImageRef           string `json:"image_ref"`
	ImageDigest        string `json:"image_digest"`
	RuntimeClass       string `json:"runtime_class"`
	ServiceAccountName string `json:"service_account_name"`
	ServiceAccountUID  string `json:"service_account_uid"`
	Audience           string `json:"audience"`
	ControlURL         string `json:"control_url"`
	ControlCAFile      string `json:"control_ca_file,omitempty"`
	StorageClass       string `json:"storage_class"`
	StorageAccessMode  string `json:"storage_access_mode"`
	VolumeSize         string `json:"volume_size"`
	WorkspaceRevision  string `json:"workspace_revision"`
	TemplateDigest     string `json:"template_digest"`
	Model              string `json:"model"`
	TTLSeconds         int64  `json:"ttl_seconds"`
}

var coldName = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
var volumeSize = regexp.MustCompile(`^[1-9][0-9]{0,3}Gi$`)
var gitRevision = regexp.MustCompile(`^[a-f0-9]{40}$`)

func (c ColdConfig) Validate() error {
	u, err := url.Parse(c.ControlURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" && u.Path != "/" {
		return model.ErrInvalid
	}
	if !coldName.MatchString(c.Namespace) || !model.ValidKey(c.ClusterID) || !coldName.MatchString(c.RuntimeClass) || !coldName.MatchString(c.ServiceAccountName) || !model.ValidText(c.ServiceAccountUID) || !model.ValidText(c.Audience) || !dnsName.MatchString(c.StorageClass) || !volumeSize.MatchString(c.VolumeSize) || !gitRevision.MatchString(c.WorkspaceRevision) || !model.ValidText(c.Model) || c.TTLSeconds < 60 || c.TTLSeconds > 24*3600 {
		return model.ErrInvalid
	}
	if c.ControlCAFile != "" && c.ControlCAFile != "/etc/pero/control-ca.pem" || c.StorageAccessMode != "ReadWriteOnce" && c.StorageAccessMode != "ReadWriteOncePod" {
		return model.ErrInvalid
	}
	if len(c.ImageDigest) != 71 || !imageDigest.MatchString(c.ImageDigest) || !strings.HasPrefix(c.ImageDigest, "sha256:") || c.ImageRef == c.ImageDigest || !strings.HasSuffix(c.ImageRef, "@"+c.ImageDigest) || strings.ContainsAny(c.ImageRef, " \t\r\n") {
		return model.ErrInvalid
	}
	digest, err := ColdTemplateDigest(c)
	if err != nil || c.TemplateDigest != digest {
		return model.ErrInvalid
	}
	return nil
}

// ColdTemplateDigest hashes the actual fixed recipe with placeholders for the
// two per-Run substitutions. Call it before Validate/NewColdOwner. No secret or
// operator credential belongs in this recipe or its receipt.
func ColdTemplateDigest(c ColdConfig) (string, error) {
	return model.Digest(struct {
		API, Policy, StorageClass, StorageAccessMode, VolumeSize string
		TTLSeconds                                               int64
		Pod                                                      coldPodSpec
	}{SandboxAPI, "Retain", c.StorageClass, c.StorageAccessMode, c.VolumeSize, c.TTLSeconds, c.pod("request-id", "workspace-volume")})
}

type PVCRef struct {
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	UID          string `json:"uid"`
	VolumeName   string `json:"volume_name,omitempty"`
	StorageClass string `json:"storage_class"`
	AccessMode   string `json:"access_mode"`
	VolumeSize   string `json:"volume_size"`
	Phase        string `json:"phase"`
	RequestID    string `json:"request_id"`
	ConfigDigest string `json:"config_digest"`
}

type coldSecurity struct {
	RunAsNonRoot   *bool  `json:"runAsNonRoot,omitempty"`
	RunAsUser      *int64 `json:"runAsUser,omitempty"`
	RunAsGroup     *int64 `json:"runAsGroup,omitempty"`
	FSGroup        *int64 `json:"fsGroup,omitempty"`
	SeccompProfile *struct {
		Type string `json:"type"`
	} `json:"seccompProfile,omitempty"`
	AllowPrivilegeEscalation *bool `json:"allowPrivilegeEscalation,omitempty"`
	Privileged               *bool `json:"privileged,omitempty"`
	ReadOnlyRootFilesystem   *bool `json:"readOnlyRootFilesystem,omitempty"`
	Capabilities             *struct {
		Drop []string `json:"drop"`
		Add  []string `json:"add,omitempty"`
	} `json:"capabilities,omitempty"`
}
type coldEnv struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}
type coldMount struct {
	Name      string `json:"name"`
	MountPath string `json:"mountPath"`
	ReadOnly  bool   `json:"readOnly,omitempty"`
}
type coldContainer struct {
	Name            string       `json:"name"`
	Image           string       `json:"image"`
	ImagePullPolicy string       `json:"imagePullPolicy"`
	Command         []string     `json:"command,omitempty"`
	Args            []string     `json:"args,omitempty"`
	Env             []coldEnv    `json:"env"`
	VolumeMounts    []coldMount  `json:"volumeMounts"`
	SecurityContext coldSecurity `json:"securityContext"`
	Resources       struct {
		Requests map[string]string `json:"requests"`
		Limits   map[string]string `json:"limits"`
	} `json:"resources"`
	TerminationMessagePath   string `json:"terminationMessagePath,omitempty"`
	TerminationMessagePolicy string `json:"terminationMessagePolicy,omitempty"`
}
type coldVolume struct {
	Name                  string `json:"name"`
	PersistentVolumeClaim *struct {
		ClaimName string `json:"claimName"`
		ReadOnly  bool   `json:"readOnly,omitempty"`
	} `json:"persistentVolumeClaim,omitempty"`
	EmptyDir *struct {
		SizeLimit string `json:"sizeLimit"`
		Medium    string `json:"medium,omitempty"`
	} `json:"emptyDir,omitempty"`
	Projected *struct {
		DefaultMode int32 `json:"defaultMode"`
		Sources     []struct {
			ServiceAccountToken struct {
				Audience          string `json:"audience"`
				ExpirationSeconds int64  `json:"expirationSeconds"`
				Path              string `json:"path"`
			} `json:"serviceAccountToken"`
		} `json:"sources"`
	} `json:"projected,omitempty"`
}
type coldPodSpec struct {
	RuntimeClassName              string          `json:"runtimeClassName"`
	ServiceAccountName            string          `json:"serviceAccountName"`
	ServiceAccount                string          `json:"serviceAccount,omitempty"`
	AutomountServiceAccountToken  *bool           `json:"automountServiceAccountToken"`
	EnableServiceLinks            *bool           `json:"enableServiceLinks"`
	HostNetwork                   bool            `json:"hostNetwork,omitempty"`
	HostPID                       bool            `json:"hostPID,omitempty"`
	HostIPC                       bool            `json:"hostIPC,omitempty"`
	ShareProcessNamespace         *bool           `json:"shareProcessNamespace,omitempty"`
	RestartPolicy                 string          `json:"restartPolicy"`
	TerminationGracePeriodSeconds int64           `json:"terminationGracePeriodSeconds"`
	SecurityContext               coldSecurity    `json:"securityContext"`
	Containers                    []coldContainer `json:"containers"`
	Volumes                       []coldVolume    `json:"volumes"`
	// Kubernetes-applied scheduling/default fields are not execution authority.
	NodeName         string `json:"nodeName,omitempty"`
	SchedulerName    string `json:"schedulerName,omitempty"`
	DNSPolicy        string `json:"dnsPolicy,omitempty"`
	Priority         *int32 `json:"priority,omitempty"`
	PreemptionPolicy string `json:"preemptionPolicy,omitempty"`
	Tolerations      []struct {
		Key, Operator, Value, Effect string
		TolerationSeconds            *int64 `json:"tolerationSeconds,omitempty"`
	} `json:"tolerations,omitempty"`
}

func strictProfile(data []byte, out any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return model.ErrIdentity
	}
	return nil
}
func ptr[T any](value T) *T { return &value }
func (c ColdConfig) pod(requestID, pvcName string) coldPodSpec {
	var pod coldPodSpec
	pod.RuntimeClassName = c.RuntimeClass
	pod.ServiceAccountName = c.ServiceAccountName
	pod.AutomountServiceAccountToken = ptr(false)
	pod.EnableServiceLinks = ptr(false)
	pod.RestartPolicy = "Never"
	pod.TerminationGracePeriodSeconds = 20
	pod.SecurityContext = coldSecurity{RunAsNonRoot: ptr(true), RunAsUser: ptr(int64(10001)), RunAsGroup: ptr(int64(10001)), FSGroup: ptr(int64(10001))}
	pod.SecurityContext.SeccompProfile = &struct {
		Type string `json:"type"`
	}{"RuntimeDefault"}
	container := coldContainer{Name: "agent", Image: c.ImageRef, ImagePullPolicy: "IfNotPresent", Env: []coldEnv{{"PERO_AGENT_CONTROL_URL", strings.TrimSuffix(c.ControlURL, "/")}, {"PERO_AGENT_RUN_ID", requestID}, {"PERO_AGENT_SESSION_ID", requestID}, {"PERO_AGENT_TOKEN_FILE", "/var/run/pero/token"}, {"PERO_AGENT_WORKSPACE", "/workspace/repo"}, {"PERO_WORKSPACE_REVISION", c.WorkspaceRevision}, {"PERO_AGENT_MODEL", c.Model}}, VolumeMounts: []coldMount{{"workspace", "/workspace", false}, {"tmp", "/tmp", false}, {"identity", "/var/run/pero", true}}}
	if c.ControlCAFile != "" {
		container.Env = append(container.Env, coldEnv{"PERO_AGENT_CA_FILE", c.ControlCAFile})
	}
	container.SecurityContext = coldSecurity{AllowPrivilegeEscalation: ptr(false), Privileged: ptr(false), ReadOnlyRootFilesystem: ptr(true)}
	container.SecurityContext.Capabilities = &struct {
		Drop []string `json:"drop"`
		Add  []string `json:"add,omitempty"`
	}{Drop: []string{"ALL"}}
	container.Resources.Requests = map[string]string{"cpu": "250m", "memory": "256Mi", "ephemeral-storage": "256Mi"}
	container.Resources.Limits = map[string]string{"cpu": "2", "memory": "2Gi", "ephemeral-storage": "1Gi"}
	pod.Containers = []coldContainer{container}
	workspace := coldVolume{Name: "workspace"}
	workspace.PersistentVolumeClaim = &struct {
		ClaimName string `json:"claimName"`
		ReadOnly  bool   `json:"readOnly,omitempty"`
	}{ClaimName: pvcName}
	tmp := coldVolume{Name: "tmp"}
	tmp.EmptyDir = &struct {
		SizeLimit string `json:"sizeLimit"`
		Medium    string `json:"medium,omitempty"`
	}{SizeLimit: "256Mi"}
	identity := coldVolume{Name: "identity"}
	identity.Projected = &struct {
		DefaultMode int32 `json:"defaultMode"`
		Sources     []struct {
			ServiceAccountToken struct {
				Audience          string `json:"audience"`
				ExpirationSeconds int64  `json:"expirationSeconds"`
				Path              string `json:"path"`
			} `json:"serviceAccountToken"`
		} `json:"sources"`
	}{DefaultMode: 0440}
	identity.Projected.Sources = append(identity.Projected.Sources, struct {
		ServiceAccountToken struct {
			Audience          string `json:"audience"`
			ExpirationSeconds int64  `json:"expirationSeconds"`
			Path              string `json:"path"`
		} `json:"serviceAccountToken"`
	}{ServiceAccountToken: struct {
		Audience          string `json:"audience"`
		ExpirationSeconds int64  `json:"expirationSeconds"`
		Path              string `json:"path"`
	}{c.Audience, 600, "token"}})
	pod.Volumes = []coldVolume{workspace, tmp, identity}
	return pod
}

func (c ColdConfig) validPod(actual coldPodSpec, request, pvc string) bool {
	// Only known API defaults may differ; all security, env, container and volume
	// fields are compared to the actual generated recipe, not a label assertion.
	return samePodProfile(actual, c.pod(request, pvc))
}
func samePodProfile(actual, expected coldPodSpec) bool {
	if actual.ServiceAccount != "" && actual.ServiceAccount != expected.ServiceAccountName {
		return false
	}
	if actual.DNSPolicy != "" && actual.DNSPolicy != "ClusterFirst" || actual.SchedulerName != "" && actual.SchedulerName != "default-scheduler" || actual.PreemptionPolicy != "" && actual.PreemptionPolicy != "PreemptLowerPriority" || actual.Priority != nil && *actual.Priority != 0 {
		return false
	}
	for _, t := range actual.Tolerations {
		if (t.Key != "node.kubernetes.io/not-ready" && t.Key != "node.kubernetes.io/unreachable") || t.Operator != "Exists" || t.Value != "" || t.Effect != "NoExecute" || t.TolerationSeconds == nil || *t.TolerationSeconds != 300 {
			return false
		}
	}
	if actual.ShareProcessNamespace != nil && !*actual.ShareProcessNamespace {
		actual.ShareProcessNamespace = nil
	}
	actual.ServiceAccount = ""
	actual.NodeName = ""
	actual.SchedulerName = ""
	actual.DNSPolicy = ""
	actual.Priority = nil
	actual.PreemptionPolicy = ""
	actual.Tolerations = nil
	for i := range actual.Containers {
		if actual.Containers[i].TerminationMessagePath != "" && actual.Containers[i].TerminationMessagePath != "/dev/termination-log" || actual.Containers[i].TerminationMessagePolicy != "" && actual.Containers[i].TerminationMessagePolicy != "File" {
			return false
		}
		actual.Containers[i].TerminationMessagePath = ""
		actual.Containers[i].TerminationMessagePolicy = ""
	}
	return reflect.DeepEqual(actual, expected)
}
