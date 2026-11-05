// Package engineeringprofile contributes opt-in engineering guidance and
// receipt-backed acceptance checks to the existing Harness lifecycle.
package engineeringprofile

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"strings"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/tasks"
)

const Version = "1"

type Mode string

const (
	Observe  Mode = "observe"
	Feedback Mode = "feedback"
)

type RequestKind string

const (
	Explain  RequestKind = "explain"
	Diagnose RequestKind = "diagnose"
	Change   RequestKind = "change"
	Monitor  RequestKind = "monitor"
	Unknown  RequestKind = "unknown"
)

// Contract is trusted host input. Model text and Task metadata cannot bind one.
// Files names the precise inputs covered by each command's evidence, not a
// claim that every dependency in the workspace was inspected.
type Contract struct {
	ID        string         `json:"id"`
	Revision  int            `json:"revision"`
	MessageID string         `json:"messageId,omitempty"`
	Kind      RequestKind    `json:"kind"`
	Goal      string         `json:"goal"`
	TaskIDs   []tasks.TaskID `json:"taskIds,omitempty"`
	Checks    []CheckSpec    `json:"checks,omitempty"`
	Delivery  *DeliverySpec  `json:"delivery,omitempty"`
}

type CheckSpec struct {
	ID       string   `json:"id"`
	Tool     string   `json:"tool"`
	Command  string   `json:"command"`
	Required bool     `json:"required"`
	Files    []string `json:"files"`
}

func (c Contract) validateRevisionAfter(revision int) error {
	if c.Revision <= revision {
		return errors.New("engineeringprofile: contract revision must advance its bound history")
	}
	return nil
}

// Validate is also used by host configuration readers before staging. The
// request MessageID is assigned by the host separately at the admission edge.
func (c Contract) Validate() error {
	if err := c.Delivery.validate(); err != nil {
		return err
	}
	if !validID(c.ID) || c.Revision < 1 || strings.TrimSpace(c.Goal) == "" || len(c.Goal) > 2048 || !utf8.ValidString(c.Goal) {
		return errors.New("engineeringprofile: contract requires id, positive revision and a UTF-8 goal of at most 2048 bytes")
	}
	switch c.Kind {
	case Explain, Diagnose, Change, Monitor, Unknown:
	default:
		return errors.New("engineeringprofile: invalid request kind")
	}
	if len(c.Checks) > 16 || len(c.TaskIDs) > 64 {
		return errors.New("engineeringprofile: contract exceeds 16 checks or 64 task references")
	}
	seen := make(map[string]bool)
	for _, check := range c.Checks {
		if !validID(check.ID) || seen[check.ID] || (check.Tool != "shell" && check.Tool != "Bash") || strings.TrimSpace(check.Command) == "" || len(check.Command) > 16384 || !utf8.ValidString(check.Command) {
			return errors.New("engineeringprofile: checks require unique ids, shell/Bash and a bounded command")
		}
		seen[check.ID] = true
		if len(check.Files) == 0 || len(check.Files) > 64 {
			return fmt.Errorf("engineeringprofile: check %s requires 1..64 input files", check.ID)
		}
		paths := make(map[string]bool)
		for _, name := range check.Files {
			if !fs.ValidPath(name) || name == "." || strings.Contains(name, "\\") || paths[name] {
				return errors.New("engineeringprofile: input files must be unique workspace-relative slash paths")
			}
			paths[name] = true
		}
	}
	seen = make(map[string]bool)
	for _, id := range c.TaskIDs {
		if !validID(string(id)) || seen[string(id)] {
			return errors.New("engineeringprofile: invalid or duplicate task reference")
		}
		seen[string(id)] = true
	}
	return nil
}

func validID(id string) bool {
	return id != "" && len(id) <= 128 && utf8.ValidString(id) && !strings.ContainsAny(id, "\x00\r\n\t ")
}

func cloneContract(c Contract) Contract {
	if c.Delivery != nil {
		d := *c.Delivery
		d.Artifacts = append([]ArtifactSpec(nil), d.Artifacts...)
		for i := range d.Artifacts {
			if d.Artifacts[i].Runes != nil {
				n := *d.Artifacts[i].Runes
				d.Artifacts[i].Runes = &n
			}
		}
		if d.FileSet != nil {
			f := *d.FileSet
			f.Files = append([]string(nil), f.Files...)
			d.FileSet = &f
		}
		c.Delivery = &d
	}
	c.TaskIDs = append([]tasks.TaskID(nil), c.TaskIDs...)
	c.Checks = append([]CheckSpec(nil), c.Checks...)
	for i := range c.Checks {
		c.Checks[i].Files = append([]string(nil), c.Checks[i].Files...)
	}
	return c
}

type CheckStatus string

const (
	Missing    CheckStatus = "missing"
	Passed     CheckStatus = "passed"
	Failed     CheckStatus = "failed"
	Stale      CheckStatus = "stale"
	Unverified CheckStatus = "unverified"
)

type CheckAssessment struct {
	ID        string      `json:"id"`
	Status    CheckStatus `json:"status"`
	ResultSeq uint64      `json:"resultSeq,omitempty"`
	Reason    string      `json:"reason,omitempty"`
}

type Assessment struct {
	ContractID  string               `json:"contractId"`
	Revision    int                  `json:"revision"`
	Ready       bool                 `json:"ready"`
	Checks      []CheckAssessment    `json:"checks"`
	OpenTasks   []tasks.TaskID       `json:"openTasks,omitempty"`
	Delivery    []DeliveryAssessment `json:"delivery,omitempty"`
	Fingerprint string               `json:"fingerprint"`
}

// Assess does not mutate task status or infer authorization from prose.
func Assess(c Contract, checks []CheckAssessment, open []tasks.TaskID, delivery ...DeliveryAssessment) Assessment {
	a := Assessment{ContractID: c.ID, Revision: c.Revision, Ready: true, Checks: append([]CheckAssessment(nil), checks...), OpenTasks: append([]tasks.TaskID(nil), open...)}
	for _, spec := range c.Checks {
		if !spec.Required {
			continue
		}
		passed := false
		for _, check := range checks {
			if check.ID == spec.ID {
				passed = check.Status == Passed
				break
			}
		}
		a.Ready = a.Ready && passed
	}
	a.Ready = a.Ready && len(open) == 0
	a.Delivery = append([]DeliveryAssessment(nil), delivery...)
	for _, row := range delivery {
		a.Ready = a.Ready && row.Status == Passed
	}
	raw, _ := json.Marshal(a)
	a.Fingerprint = digest(raw)
	return a
}

func checkDigest(spec CheckSpec) string {
	raw, _ := json.Marshal(spec)
	return digest(raw)
}

func digest(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
