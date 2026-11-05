package session

import (
	"encoding/json"
	"reflect"
	"testing"
)

func planReceipt(plan ContextPlan) map[string]any {
	return map[string]any{"kind": plan.Kind, "digest": plan.Digest(), "memoryTokens": plan.MemoryTokens, "memoryBudget": plan.MemoryBudget}
}

func TestContextPlanStableDigestAndReplay(t *testing.T) {
	s := NewSession("plan", "")
	mustAppend(t, s, "user/message", Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "hello"}}})
	plan, err := s.ContextPlan()
	if err != nil {
		t.Fatal(err)
	}
	const want = "sha256:74c432f8ed335b7e8afc8d7b480bc14f55e419a39d28e4e36d1e6b63aefee2f0"
	if got := plan.Digest(); got != want {
		t.Fatalf("digest = %s; plan=%+v", got, plan)
	}
	receipt := mustAppend(t, s, "request/context-plan", planReceipt(plan))
	restored, err := RestoreSession(s.Header(), s.Events())
	if err != nil {
		t.Fatal(err)
	}
	input, seq, err := restored.LatestInputPlan()
	if err != nil || seq != receipt.Seq || input.Digest() != plan.Digest() {
		t.Fatalf("input=%+v seq=%d err=%v", input, seq, err)
	}
	before := s.Events()
	for _, key := range []string{"digest", "memoryTokens", "memoryBudget"} {
		bad := planReceipt(plan)
		if key == "digest" {
			bad[key] = "sha256:wrong"
		} else {
			bad[key] = -1
		}
		if _, err := s.Append("request/context-plan", bad); err == nil {
			t.Fatalf("accepted bad %s", key)
		}
	}
	if !reflect.DeepEqual(before, s.Events()) {
		t.Fatal("invalid receipt changed log")
	}
}

func TestContextPlanRejectsPointReceiptsWithoutReinterpretation(t *testing.T) {
	for _, kind := range []string{"point.context.plan.v1", "point.context.plan.v2", "point.context.plan.v3", "point.context.plan.v4"} {
		t.Run(kind, func(t *testing.T) {
			s := NewSession("old-receipt", "")
			plan, err := s.ContextPlan()
			if err != nil {
				t.Fatal(err)
			}
			payload := planReceipt(plan)
			payload["kind"] = kind
			if _, err := s.Append("request/context-plan", payload); err == nil {
				t.Fatal("accepted foreign policy receipt")
			}
			raw, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := RestoreSession(s.Header(), []Event{{Seq: 1, Type: "request/context-plan", Data: raw}}); err == nil {
				t.Fatal("restored foreign policy receipt")
			}
		})
	}
}

func TestContextPlanDoesNotInterpretProductPolicyMetadata(t *testing.T) {
	s := NewSession("opaque-policy", "")
	for _, text := range []string{"first", "second"} {
		mustAppend(t, s, "user/message", Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: text}}, Source: json.RawMessage(`{"plugin":"@point/channels-memory","view":{"turn":2},"sourceRules":[{"eventDigest":"any","eventSeq":1,"throughSeq":2}]}`)})
	}
	plan, err := s.ContextPlan()
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Messages()) != 2 || len(plan.Omitted) != 0 || plan.MemoryBudget != 0 || plan.MemoryTokens != 0 {
		t.Fatalf("product metadata changed plan: %+v", plan)
	}
	if plan.Messages()[0].Content[0].Text != "first" || plan.Messages()[1].Content[0].Text != "second" {
		t.Fatal("surface order changed")
	}
	if string(plan.Messages()[0].Source) != string(plan.Messages()[1].Source) {
		t.Fatal("opaque source changed")
	}
}

func TestContextPlanPreviewDoesNotPublishOrRetainPendingMessages(t *testing.T) {
	s := NewSession("preview", "")
	mustAppend(t, s, "user/message", inboxFixtureMessage("committed", "original"))
	for _, text := range []string{"discarded preview", "another preview"} {
		preview, err := s.ContextPlanWithMessages([]Message{inboxFixtureMessage("pending", text)})
		if err != nil || len(preview.Nodes) != 2 || preview.Nodes[1].Message.Content[0].Text != text {
			t.Fatalf("preview=%+v err=%v", preview, err)
		}
		// Caller-owned output must not mutate the next projection or raw log.
		preview.Nodes[0].Message.Content[0].Text = "caller mutation"
		preview.Nodes[0].Message.Source[0] = '!'
	}
	if len(s.Events()) != 1 {
		t.Fatal("preview published pending messages")
	}
	// This append reuses the sequence that belonged only to the preview.
	mustAppend(t, s, "user/message", inboxFixtureMessage("actual", "actual admission"))
	plan, err := s.ContextPlan()
	if err != nil || len(plan.Nodes) != 2 || plan.Nodes[0].Message.Content[0].Text != "original" || plan.Nodes[1].Message.ID != "actual" || plan.Nodes[1].Message.Content[0].Text != "actual admission" {
		t.Fatalf("committed plan=%+v err=%v", plan, err)
	}
	if string(plan.Nodes[0].Message.Source) != `{"kind":"user"}` {
		t.Fatal("caller mutation escaped into later projection")
	}
}

func TestContextPlanWarmReadsPreserveProjectionAndReplay(t *testing.T) {
	s := NewSession("warm-projection", "")
	user := mustAppend(t, s, "user/message", Message{Role: RoleUser, Content: []ContentBlock{imageBlock("one"), imageBlock("two")}})
	verify := func() {
		t.Helper()
		cold, err := BuildContextPlan(s.Events(), s.SurfaceSeqs())
		if err != nil {
			t.Fatal(err)
		}
		for range 2 {
			warm, err := s.ContextPlan()
			if err != nil || !reflect.DeepEqual(warm, cold) {
				t.Fatalf("warm=%+v cold=%+v err=%v", warm, cold, err)
			}
		}
		restored, err := RestoreSession(s.Header(), s.Events())
		if err != nil {
			t.Fatal(err)
		}
		plan, err := restored.ContextPlan()
		if err != nil || plan.Digest() != cold.Digest() {
			t.Fatalf("restored=%+v err=%v", plan, err)
		}
	}
	verify()
	for _, index := range []int{0, 1} {
		mustAppend(t, s, "image/offload", imageOffload(user.Seq, index))
		verify()
	}
	if _, err := s.AppendReplacement("user/message", inboxFixtureMessage("summary", "summary"), SurfaceRange{Start: user.Seq, End: user.Seq}, []uint64{user.Seq}); err != nil {
		t.Fatal(err)
	}
	verify()
	for _, prompt := range []string{"first prompt", "revised prompt"} {
		if err := s.CommitSystemPrompt(1, 1, prompt, false, false); err != nil {
			t.Fatal(err)
		}
		verify()
	}
}
