package harness

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

// UserQuestion is a Claude-compatible question. Option previews are inert
// presentation data; renderers must not treat them as trusted executable HTML.
type UserQuestion struct {
	Question    string               `json:"question"`
	Header      string               `json:"header"`
	Options     []UserQuestionOption `json:"options"`
	MultiSelect bool                 `json:"multiSelect"`
}

type UserQuestionOption struct {
	Label       string `json:"label"`
	Description string `json:"description"`
	Preview     string `json:"preview,omitempty"`
}

type UserQuestionRequest struct {
	Agent     *Agent         `json:"-"`
	CallID    ToolCallID     `json:"toolCallId"`
	Questions []UserQuestion `json:"questions"`
}

// UserQuestionAnswer names choices by their original zero-based indices.
// Text carries the user's own Other answer. A multi-select may combine both.
type UserQuestionAnswer struct {
	QuestionIndex   int    `json:"questionIndex"`
	SelectedOptions []int  `json:"selectedOptions"`
	Text            string `json:"text,omitempty"`
}

type UserQuestionOutcome string

const (
	UserQuestionAnswered  UserQuestionOutcome = "answered"
	UserQuestionCancelled UserQuestionOutcome = "cancelled"
)

type UserQuestionReply struct {
	Outcome UserQuestionOutcome  `json:"outcome"`
	Answers []UserQuestionAnswer `json:"answers,omitempty"`
}

type UserQuestionHandler func(context.Context, UserQuestionRequest) (UserQuestionReply, error)

// UserQuestionBroker separates human answers from permission policy. Its
// trusted transport must obtain answers from the user, never from model input.
// Questions wait until the transport answers or the admitted tool is cancelled.
type UserQuestionBroker struct{ handler UserQuestionHandler }

func NewUserQuestionBroker(handler UserQuestionHandler) (*UserQuestionBroker, error) {
	if handler == nil {
		return nil, errors.New("harness: user questions require an input transport")
	}
	return &UserQuestionBroker{handler: handler}, nil
}

func (b *UserQuestionBroker) Ask(ctx context.Context, request UserQuestionRequest) (UserQuestionReply, error) {
	if b == nil || b.handler == nil {
		return UserQuestionReply{}, errors.New("harness: user question transport unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return UserQuestionReply{}, err
	}
	if request.Agent == nil || request.Agent.Parent() != nil || request.Agent.Delegated() || request.Agent.retired.Load() {
		return UserQuestionReply{}, errors.New("harness: user questions require a live root agent")
	}
	if err := validateUserQuestions(request.Questions); err != nil {
		return UserQuestionReply{}, err
	}
	// Retain the original choices: even a transport mutating its detached input
	// cannot change which labels an answer is authorized to select.
	questions := cloneUserQuestions(request.Questions)
	request.Questions = cloneUserQuestions(questions)
	reply, err := b.handler(ctx, request)
	if err != nil {
		return UserQuestionReply{}, err
	}
	if err := ctx.Err(); err != nil {
		return UserQuestionReply{}, err
	}
	if err := validateUserQuestionReply(questions, reply); err != nil {
		return UserQuestionReply{}, err
	}
	for index := range reply.Answers {
		reply.Answers[index].SelectedOptions = append([]int(nil), reply.Answers[index].SelectedOptions...)
	}
	return reply, nil
}

func validateUserQuestions(questions []UserQuestion) error {
	if len(questions) < 1 || len(questions) > 4 {
		return errors.New("harness: AskUserQuestion requires 1-4 questions")
	}
	seen := make(map[string]bool, len(questions))
	for index, question := range questions {
		if strings.TrimSpace(question.Question) == "" || len(question.Question) > 4096 || seen[question.Question] {
			return fmt.Errorf("harness: question %d needs unique nonempty text of at most 4096 bytes", index)
		}
		seen[question.Question] = true
		if strings.TrimSpace(question.Header) == "" || utf8.RuneCountInString(question.Header) > 12 {
			return fmt.Errorf("harness: question %d header must contain 1-12 characters", index)
		}
		if len(question.Options) < 2 || len(question.Options) > 4 {
			return fmt.Errorf("harness: question %d requires 2-4 options", index)
		}
		labels := make(map[string]bool, len(question.Options))
		for _, option := range question.Options {
			if strings.TrimSpace(option.Label) == "" || len(option.Label) > 512 || labels[option.Label] || len(option.Description) > 4096 || len(option.Preview) > 16384 {
				return fmt.Errorf("harness: question %d has an empty, duplicate or oversized option", index)
			}
			labels[option.Label] = true
		}
	}
	return nil
}

func validateUserQuestionReply(questions []UserQuestion, reply UserQuestionReply) error {
	if reply.Outcome == UserQuestionCancelled && len(reply.Answers) == 0 {
		return nil
	}
	if reply.Outcome != UserQuestionAnswered || len(reply.Answers) != len(questions) {
		return errors.New("harness: user answer must answer every question exactly once, or cancel without answers")
	}
	seen := make(map[int]bool, len(questions))
	for _, answer := range reply.Answers {
		index := answer.QuestionIndex
		if index < 0 || index >= len(questions) || seen[index] {
			return errors.New("harness: user answer has an unknown or duplicate question index")
		}
		seen[index] = true
		question := questions[index]
		count := len(answer.SelectedOptions)
		if strings.TrimSpace(answer.Text) != "" {
			count++
		}
		if count == 0 || !question.MultiSelect && count != 1 || len(answer.Text) > 16384 {
			return fmt.Errorf("harness: user answer %d has an invalid selection count or oversized text", index)
		}
		selected := make(map[int]bool, len(answer.SelectedOptions))
		for _, option := range answer.SelectedOptions {
			if option < 0 || option >= len(question.Options) || selected[option] {
				return fmt.Errorf("harness: user answer %d has an unknown or duplicate option index", index)
			}
			selected[option] = true
		}
	}
	return nil
}

func cloneUserQuestions(questions []UserQuestion) []UserQuestion {
	result := append([]UserQuestion(nil), questions...)
	for index := range result {
		result[index].Options = append([]UserQuestionOption(nil), result[index].Options...)
	}
	return result
}
