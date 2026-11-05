package tool

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/model"
	"github.com/phodal/pero/harness/go/session"
)

func TestReadReuseSurfaceLifecycle(t *testing.T) {
	for _, mode := range []string{"visible", "restore", "fork", "removed anchor", "pruned anchor", "changed presentation"} {
		t.Run(mode, func(t *testing.T) {
			s := session.NewSession("read-reuse", "")
			s.Append("turn/start", struct {
				Turn int `json:"turn"`
			}{1})
			text := strings.Repeat("complete file content\n", 100)
			var first, second model.Event
			for i := 0; i < 2; i++ {
				block := model.ContentBlock{Type: model.BlockToolResult, ToolCallID: model.ToolCallID(fmt.Sprint(i)), Content: []model.ContentBlock{{Type: model.BlockText, Text: text}}, Meta: ReusableReadMetadata("file.go", "sha256:fresh", text)}
				if mode == "changed presentation" && i == 1 {
					block.Content[0].Text += "\nnew instructions"
				}
				e, err := s.Append("tool/result", block)
				if err != nil {
					t.Fatal(err)
				}
				if i == 0 {
					first = e
				} else {
					second = e
				}
			}
			var reuse ReadReuse
			if err := reuse.Reconcile(s); err != nil {
				t.Fatal(err)
			}
			plan, err := s.ContextPlan()
			if err != nil {
				t.Fatal(err)
			}
			projected := plan.Nodes[len(plan.Nodes)-1]
			if mode == "changed presentation" {
				if projected.Seq != second.Seq {
					t.Fatal("rewritten presentation was reused")
				}
				return
			}
			if projected.Seq == second.Seq || !strings.Contains(projected.Message.Content[0].Content[0].Text, "identical") {
				t.Fatal("missing reuse projection")
			}
			// A stable request boundary is idempotent and keeps both call identities.
			count := len(s.Events())
			if err := reuse.Reconcile(s); err != nil || len(s.Events()) != count {
				t.Fatal("repeated boundary appended replacements", err)
			}
			s.Append("turn/end", struct {
				Turn int `json:"turn"`
			}{1})
			if mode == "fork" {
				s, err = s.ForkCompleted("forked", nil)
			} else {
				s, err = session.RestoreSession(s.Header(), s.Events())
			}
			if err != nil {
				t.Fatal(err)
			}
			s.Append("turn/start", struct {
				Turn int `json:"turn"`
			}{2})
			reuse = ReadReuse{}
			removed := mode == "removed anchor" || mode == "pruned anchor"
			if mode == "removed anchor" {
				_, err = s.AppendReplacement("user/message", model.Message{Role: model.RoleUser, Content: []model.ContentBlock{{Type: model.BlockText, Text: "summary"}}}, session.SurfaceRange{Start: first.Seq, End: first.Seq}, []uint64{first.Seq})
			}
			if mode == "pruned anchor" {
				var b model.ContentBlock
				json.Unmarshal(first.Data, &b)
				b.Content[0].Text = "[omitted]"
				raw, _ := json.Marshal(b)
				_, err = s.AppendPrunedToolResult(first.Seq, raw, 100)
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := reuse.Reconcile(s); err != nil {
				t.Fatal(err)
			}
			plan, err = s.ContextPlan()
			if err != nil {
				t.Fatal(err)
			}
			last := plan.Nodes[len(plan.Nodes)-1].Message.Content[0]
			if last.ToolCallID != "1" {
				t.Fatal("lost result identity")
			}
			if removed && (last.Content[0].Text != text || decodeReusableRead(mustReadJSON(t, last)).meta.Reuse != nil) {
				t.Fatal("dangling reference after anchor removal")
			}
			read, err := ReadSessionToolOutput(s, fmt.Sprintf("session-tool-result:read-reuse:%d", second.Seq), 0, 1<<20)
			if err != nil || read.Read == nil || read.Read.Text != text {
				t.Fatal("lost exact raw result", err)
			}
		})
	}
}

func mustReadJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestReadReuseEqualityAndSize(t *testing.T) {
	for _, tt := range []struct {
		name, path, digest, text string
		reuse                    bool
	}{
		{"same", "file", "sha256:a", strings.Repeat("a", 1500), true},
		{"changed bytes", "file", "sha256:b", strings.Repeat("b", 1500), false},
		{"different path", "other", "sha256:a", strings.Repeat("a", 1500), false},
		{"small", "file", "sha256:a", "small", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			s := session.NewSession("equal", "")
			s.Append("turn/start", struct {
				Turn int `json:"turn"`
			}{1})
			first := strings.Repeat("a", 1500)
			if tt.name == "small" {
				first = "small"
			}
			for _, r := range []struct{ path, digest, text string }{{"file", "sha256:a", first}, {tt.path, tt.digest, tt.text}} {
				s.Append("tool/result", model.ContentBlock{Type: model.BlockToolResult, ToolCallID: "reused-id", Content: []model.ContentBlock{{Type: model.BlockText, Text: r.text}}, Meta: ReusableReadMetadata(r.path, r.digest, r.text)})
			}
			before := len(s.Events())
			var p ReadReuse
			if err := p.Reconcile(s); err != nil {
				t.Fatal(err)
			}
			if (len(s.Events()) > before) != tt.reuse {
				t.Fatal("incorrect reuse eligibility")
			}
		})
	}
}
