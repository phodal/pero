package acp

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

// This is a negotiated Pero extension, not an ACP standard request. Clients
// must advertise revision 1 only after implementing the complete input UI.
const UserQuestionsCapability = "pero.userQuestions"
const UserQuestionsMethod = "_pero/user_questions/ask"
const UserQuestionsCancelMethod = "_pero/user_questions/cancel"

type userQuestionsParams struct {
	SessionID harness.SessionID `json:"sessionId"`
	harness.UserQuestionRequest
}

func (s *Server) negotiateUserQuestions(raw json.RawMessage) error {
	var params struct {
		Capabilities struct {
			Meta struct {
				Questions int `json:"pero.userQuestions"`
			} `json:"_meta"`
		} `json:"clientCapabilities"`
	}
	if len(raw) != 0 {
		if err := json.Unmarshal(raw, &params); err != nil {
			return err
		}
	}
	s.mu.Lock()
	s.userQuestions = s.questionTools && params.Capabilities.Meta.Questions == 1
	s.mu.Unlock()
	return nil
}

func (s *Server) extensionCapabilities() map[string]int {
	result := map[string]int{"pero.mcpRuntime": 1}
	if s.questionTools {
		result[UserQuestionsCapability] = 1
	}
	return result
}

func (s *Server) registerUserQuestions(run *point.Run, agent *harness.Agent) error {
	s.mu.Lock()
	negotiated := s.userQuestions
	s.mu.Unlock()
	if !negotiated {
		return nil
	}
	broker, err := harness.NewUserQuestionBroker(s.askUserQuestions)
	if err != nil {
		return err
	}
	return broker.Register(run, s.h.Tools(), agent)
}

func (s *Server) askUserQuestions(ctx context.Context, question harness.UserQuestionRequest) (harness.UserQuestionReply, error) {
	s.mu.Lock()
	negotiated, writer := s.userQuestions, s.writer
	s.mu.Unlock()
	if !negotiated || writer == nil {
		return harness.UserQuestionReply{}, errors.New("acp: user question extension was not negotiated")
	}
	params := userQuestionsParams{SessionID: question.Agent.ID(), UserQuestionRequest: question}
	raw, err := s.requestClient(ctx, UserQuestionsMethod, params)
	if err != nil {
		if ctx.Err() != nil {
			// Correlates dismissal with the original tool call. A late answer is
			// discarded by requestClient's existing pending-request authority.
			payload, _ := json.Marshal(struct {
				SessionID harness.SessionID  `json:"sessionId"`
				CallID    harness.ToolCallID `json:"toolCallId"`
			}{params.SessionID, question.CallID})
			_ = writer.write(request{JSONRPC: "2.0", Method: UserQuestionsCancelMethod, Params: payload})
		}
		return harness.UserQuestionReply{}, err
	}
	var wire struct {
		Outcome harness.UserQuestionOutcome `json:"outcome"`
		Answers []struct {
			QuestionIndex   *int   `json:"questionIndex"`
			SelectedOptions []int  `json:"selectedOptions"`
			Text            string `json:"text,omitempty"`
		} `json:"answers,omitempty"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return harness.UserQuestionReply{}, err
	}
	reply := harness.UserQuestionReply{Outcome: wire.Outcome}
	for _, answer := range wire.Answers {
		if answer.QuestionIndex == nil {
			return harness.UserQuestionReply{}, errors.New("acp: user answer requires questionIndex")
		}
		reply.Answers = append(reply.Answers, harness.UserQuestionAnswer{QuestionIndex: *answer.QuestionIndex, SelectedOptions: answer.SelectedOptions, Text: answer.Text})
	}
	return reply, nil // The broker owns answer/selection validation.
}
