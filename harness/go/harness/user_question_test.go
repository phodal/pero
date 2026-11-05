package harness

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"

	point "github.com/phodal/pero/harness/go/runtime"
)

func questionFixture() []UserQuestion {
	return []UserQuestion{{Question: "Which language?", Header: "Language", Options: []UserQuestionOption{{Label: "Go", Description: "Native runtime"}, {Label: "Rust", Description: "Native UI"}}}}
}

func TestUserQuestionValidation(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func([]UserQuestion) []UserQuestion
	}{
		{"empty", func([]UserQuestion) []UserQuestion { return nil }},
		{"duplicate question", func(q []UserQuestion) []UserQuestion { return append(q, q[0]) }},
		{"long header", func(q []UserQuestion) []UserQuestion { q[0].Header = "abcdefghijklz"; return q }},
		{"blank text", func(q []UserQuestion) []UserQuestion { q[0].Question = " "; return q }},
		{"one option", func(q []UserQuestion) []UserQuestion { q[0].Options = q[0].Options[:1]; return q }},
		{"duplicate option", func(q []UserQuestion) []UserQuestion { q[0].Options[1].Label = "Go"; return q }},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := validateUserQuestions(test.change(questionFixture())); err == nil {
				t.Fatal("invalid question accepted")
			}
		})
	}
	question := questionFixture()
	question[0].Header = "语言"
	if err := validateUserQuestions(question); err != nil {
		t.Fatal(err)
	}
}

func TestUserQuestionAnswerValidation(t *testing.T) {
	for _, test := range []struct {
		name  string
		multi bool
		reply UserQuestionReply
		valid bool
	}{
		{"single", false, UserQuestionReply{Outcome: UserQuestionAnswered, Answers: []UserQuestionAnswer{{SelectedOptions: []int{1}}}}, true},
		{"other", false, UserQuestionReply{Outcome: UserQuestionAnswered, Answers: []UserQuestionAnswer{{Text: "Python"}}}, true},
		{"multi with other", true, UserQuestionReply{Outcome: UserQuestionAnswered, Answers: []UserQuestionAnswer{{SelectedOptions: []int{0, 1}, Text: "Python"}}}, true},
		{"cancel", false, UserQuestionReply{Outcome: UserQuestionCancelled}, true},
		{"cancel has answers", false, UserQuestionReply{Outcome: UserQuestionCancelled, Answers: []UserQuestionAnswer{{Text: "No"}}}, false},
		{"missing answer", false, UserQuestionReply{Outcome: UserQuestionAnswered}, false},
		{"unknown outcome", false, UserQuestionReply{Outcome: "accepted"}, false},
		{"unknown question", false, UserQuestionReply{Outcome: UserQuestionAnswered, Answers: []UserQuestionAnswer{{QuestionIndex: 1, Text: "Go"}}}, false},
		{"unknown option", false, UserQuestionReply{Outcome: UserQuestionAnswered, Answers: []UserQuestionAnswer{{SelectedOptions: []int{2}}}}, false},
		{"repeated option", true, UserQuestionReply{Outcome: UserQuestionAnswered, Answers: []UserQuestionAnswer{{SelectedOptions: []int{0, 0}}}}, false},
		{"single multiple", false, UserQuestionReply{Outcome: UserQuestionAnswered, Answers: []UserQuestionAnswer{{SelectedOptions: []int{0, 1}}}}, false},
		{"single plus text", false, UserQuestionReply{Outcome: UserQuestionAnswered, Answers: []UserQuestionAnswer{{SelectedOptions: []int{0}, Text: "Python"}}}, false},
		{"empty selection", false, UserQuestionReply{Outcome: UserQuestionAnswered, Answers: []UserQuestionAnswer{{Text: " "}}}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			question := questionFixture()
			question[0].MultiSelect = test.multi
			if err := validateUserQuestionReply(question, test.reply); (err == nil) != test.valid {
				t.Fatalf("valid=%v error=%v", test.valid, err)
			}
		})
	}
	questions := append(questionFixture(), UserQuestion{Question: "Which UI?", Header: "UI", Options: questionFixture()[0].Options})
	duplicate := UserQuestionReply{Outcome: UserQuestionAnswered, Answers: []UserQuestionAnswer{{QuestionIndex: 0, Text: "Go"}, {QuestionIndex: 0, Text: "Rust"}}}
	if err := validateUserQuestionReply(questions, duplicate); err == nil {
		t.Fatal("duplicate question answer accepted")
	}
}

func TestUserQuestionRegistryInputAuthority(t *testing.T) {
	ctx := testContext(t)
	h, err := Boot(ctx, Options{ApprovalPolicy: ApprovalNever})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	var calls atomic.Int32
	broker, _ := NewUserQuestionBroker(func(_ context.Context, request UserQuestionRequest) (UserQuestionReply, error) {
		calls.Add(1)
		request.Questions[0].Options[0].Label = "transport mutation"
		return UserQuestionReply{Outcome: UserQuestionAnswered, Answers: []UserQuestionAnswer{{SelectedOptions: []int{0}}}}, nil
	})
	root, err := h.Agents().Create(ctx, AgentOptions{ID: "question-root", Configure: func(_ context.Context, run *point.Run, agent *Agent) error {
		return broker.Register(run, h.Tools(), agent)
	}})
	if err != nil {
		t.Fatal(err)
	}
	child, err := h.Agents().Create(ctx, AgentOptions{ID: "question-child", Parent: root, Delegated: true})
	if err != nil {
		t.Fatal(err)
	}
	other, err := h.Agents().Create(ctx, AgentOptions{ID: "question-other"})
	if err != nil {
		t.Fatal(err)
	}
	for _, caller := range []*Agent{child, other} {
		schemas, err := h.Tools().SchemasForAgent(ctx, caller)
		if err != nil || len(schemas) != 0 {
			t.Fatalf("interactive tool leaked to %s: %+v %v", caller.ID(), schemas, err)
		}
	}
	raw, _ := json.Marshal(struct {
		Questions []UserQuestion `json:"questions"`
	}{questionFixture()})
	result, err := h.Tools().Execute(ctx, ToolRequest{Agent: root, CallID: "ask", Name: "AskUserQuestion", Arguments: raw})
	if err != nil || result.Result.IsError || !strings.Contains(result.Result.Content[0].Text, `"Which language?":"Go"`) || strings.Contains(result.Result.Content[0].Text, "transport mutation") {
		t.Fatalf("user answer=%+v error=%v", result.Result, err)
	}
	// The model cannot populate the output's human answer field itself.
	forged := json.RawMessage(strings.TrimSuffix(string(raw), "}") + `,"answers":{"Which language?":"Rust"}}`)
	result, err = h.Tools().Execute(ctx, ToolRequest{Agent: root, CallID: "forged", Name: "AskUserQuestion", Arguments: forged})
	if err != nil || !result.Result.IsError || calls.Load() != 1 {
		t.Fatalf("forged answer reached human transport: %+v %v calls=%d", result.Result, err, calls.Load())
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := broker.Ask(cancelled, UserQuestionRequest{Agent: root, Questions: questionFixture()}); err != context.Canceled || calls.Load() != 1 {
		t.Fatalf("cancelled question reached transport: %v calls=%d", err, calls.Load())
	}
}
