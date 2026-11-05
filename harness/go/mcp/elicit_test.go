package mcp

import (
	"context"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"testing"
)

func TestElicitationCallerAttribution(t *testing.T) {
	for _, row := range []struct {
		name        string
		second      any
		finishFirst bool
	}{
		{"out of order completion", "second", true},
		{"reverse completion", "second", false},
		{"unattributed overlapping call", nil, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			var calls activeToolCalls
			first := calls.push(WithToolCaller(t.Context(), "first"))
			second := calls.push(WithToolCaller(t.Context(), row.second))
			answer := func(_ context.Context, _ ElicitationRequest, caller any) (ElicitationReply, error) {
				return ElicitationReply{Action: "accept"}, nil
			}
			result, err := elicit(t.Context(), answer, &sdk.ElicitParams{}, calls.current())
			if err != nil || result.Action != "decline" {
				t.Fatalf("ambiguous elicitation answered: %+v %v", result, err)
			}
			want := any("first")
			if row.finishFirst {
				first()
				want = row.second
			} else {
				second()
			}
			if calls.current() != want {
				t.Fatalf("remaining caller=%v want=%v", calls.current(), want)
			}
			result, err = elicit(t.Context(), answer, &sdk.ElicitParams{}, calls.current())
			if err != nil || result.Action != "accept" {
				t.Fatalf("sole caller rejected: %+v %v", result, err)
			}
			first()
			second()
			if calls.current() != nil {
				t.Fatal("completed caller retained")
			}
		})
	}
}
