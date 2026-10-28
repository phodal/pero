package github

import (
	"reflect"
	"strings"
	"testing"
)

func TestRoadmapChecklistSemantics(t *testing.T) {
	cases := []struct {
		name    string
		source  string
		want    int
		partial bool
	}{
		{"headings and nested goals", "# Roadmap\n## Ship\n- [ ] 父任务. Parent goal #backend <!--pero:id:parent-->\n  Context for parent.\n  - [x] Child. Child goal #go <!-- pero:id: child -->\n- [X] Done. Completed goal\n", 3, false},
		{"fences and inline code", "# Roadmap\n```md\n- [ ] example\n```\n- [ ] Real `#not-a-tag` #yes\n", 1, false},
		{"identity example remains data", "- [ ] Real `<!--pero:id:literal-->`\n\n  ```md\n  <!--pero:id:example-->\n  - [ ] example\n  ```\n", 1, false},
		{"ordinary and ordered lists", "- ordinary\n  - [ ] Nested goal\n1. [x] Ordered goal\n", 2, false},
		{"duplicate implicit goals", "## Same\n- [ ] Goal\n- [ ] Goal\n", 0, true},
		{"duplicate explicit ids", "- [ ] A <!--pero:id:one-->\n  - [ ] Child\n- [ ] B <!--pero:id:one-->\n", 0, true},
		{"invalid explicit id", "- [ ] Goal <!--pero:id:bad id-->\n", 0, true},
		{"misspelled explicit id", "- [ ] Goal <!--pero:id missing-colon-->\n", 0, true},
		{"empty goal", "- [ ] <!--pero:id:empty-->\n", 0, true},
		{"oversized goal", "- [ ] " + strings.Repeat("x", 241), 0, true},
		{"long description with short title", "- [ ] Goal. " + strings.Repeat("x", 241), 1, false},
		{"empty title before description", "- [ ] . Description", 0, true},
		{"invalid UTF8", string([]byte{'-', ' ', '[', ' ', ']', ' ', 0xff}), 0, true},
		{"NUL", "- [ ] Goal\x00", 0, true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			parsed := ParseRoadmap([]byte(test.source))
			if len(parsed.Items) != test.want || parsed.Partial != test.partial {
				t.Fatalf("items=%+v partial=%v errors=%v", parsed.Items, parsed.Partial, parsed.Errors)
			}
			if test.partial && len(parsed.Errors) == 0 {
				t.Fatal("partial parse omitted its explanation")
			}
		})
	}
	parsed := ParseRoadmap([]byte(cases[0].source))
	parent, child, done := parsed.Items[0], parsed.Items[1], parsed.Items[2]
	if parent.ID != "parent" || child.ID != "child" || child.ParentID != parent.ID || parent.Checked || !child.Checked || !done.Checked {
		t.Fatalf("hierarchy/check state: %+v", parsed.Items)
	}
	if parent.Title != "父任务" || child.Title != "Child" || done.Title != "Done" {
		t.Fatalf("descriptions became list titles: %+v", parsed.Items)
	}
	if parent.Line != 3 || child.Line != 5 || !reflect.DeepEqual(parent.Headings, []string{"Roadmap", "Ship"}) || !reflect.DeepEqual(parent.Tags, []string{"backend"}) || !reflect.DeepEqual(child.Tags, []string{"go"}) {
		t.Fatalf("source context: %+v", parsed.Items)
	}
	if !strings.Contains(parent.Text, "父任务. Parent goal #backend") || !strings.Contains(parent.Text, "Context for parent.") || strings.Contains(parent.Text, "Child") || strings.Contains(parent.Text, "pero:id") {
		t.Fatalf("parent goal included child or lost context: %q", parent.Text)
	}
	code := ParseRoadmap([]byte(cases[1].source))
	if !reflect.DeepEqual(code.Items[0].Tags, []string{"yes"}) {
		t.Fatalf("code span became a tag: %+v", code.Items[0])
	}
	context := ParseRoadmap([]byte("- [ ] Preserve example\n\n  ```python\n  if ready:\n      run()\n  ```\n"))
	if context.Partial || !strings.Contains(context.Items[0].Text, "```python\nif ready:\n    run()\n```") {
		t.Fatalf("fenced context changed semantics: %+v", context)
	}
}

func TestRoadmapSourceIdentity(t *testing.T) {
	original := "# Group\n- [ ] Parent. Plan work.\n  - [ ] Child. Finish work.\n- [ ] Stable. Keep this goal. <!--pero:id:stable-->\n"
	first := ParseRoadmap([]byte(original))
	moved := ParseRoadmap([]byte("Introduction.\n\n" + strings.ReplaceAll(original, "[ ]", "[x]")))
	if len(first.Items) != 3 || len(moved.Items) != 3 {
		t.Fatalf("identity fixture rejected: %+v %+v", first, moved)
	}
	for i := range first.Items {
		if first.Items[i].ID != moved.Items[i].ID || first.Items[i].ParentID != moved.Items[i].ParentID || first.Items[i].Line == moved.Items[i].Line {
			t.Fatalf("line/check state changed identity: %+v %+v", first.Items[i], moved.Items[i])
		}
	}
	renamed := ParseRoadmap([]byte(strings.ReplaceAll(original, "Stable", "Renamed")))
	if renamed.Items[2].ID != "stable" {
		t.Fatal("explicit id changed on rename")
	}
	body := ParseRoadmap([]byte(strings.Replace(original, "Parent. Plan work.\n", "Parent. Plan work.\n  Extra requirement.\n", 1)))
	if body.Items[0].ID != first.Items[0].ID || !strings.Contains(body.Items[0].Text, "Extra requirement.") {
		t.Fatal("continuation changed identity or lost requirement")
	}
	description := ParseRoadmap([]byte(strings.ReplaceAll(original, "work.", "updated requirements.")))
	if description.Partial || len(description.Items) != len(first.Items) {
		t.Fatalf("description edit rejected: %+v", description)
	}
	for i := range first.Items {
		if description.Items[i].ID != first.Items[i].ID || description.Items[i].Title != first.Items[i].Title || description.Items[i].ParentID != first.Items[i].ParentID {
			t.Fatalf("description edit changed identity: %+v %+v", first.Items[i], description.Items[i])
		}
	}
	if !strings.Contains(description.Items[0].Text, "Plan updated requirements.") || !strings.Contains(description.Items[1].Text, "Finish updated requirements.") {
		t.Fatal("description edit lost execution context")
	}
	differentParents := ParseRoadmap([]byte("- [ ] A\n  - [ ] Child\n- [ ] B\n  - [ ] Child\n"))
	if differentParents.Partial || len(differentParents.Items) != 4 || differentParents.Items[1].ID == differentParents.Items[3].ID {
		t.Fatalf("different parents conflated: %+v", differentParents)
	}
}
