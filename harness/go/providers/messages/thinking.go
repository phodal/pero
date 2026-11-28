package messages

import (
	"encoding/json"
	"errors"
	"io"

	"github.com/phodal/pero/harness/go/model"
)

const thinkingExtension = "deepseekMessagesThinkingV1"

// ReplayRoute is a locally admitted scope and model, not a provider response
// field. Scope must distinguish provider, endpoint and credential identity.
// Never use a raw credential as Scope; it is committed with the message.
type ReplayRoute struct {
	Scope string `json:"scope"`
	Model string `json:"model"`
}

func (r ReplayRoute) valid() bool { return r.Scope != "" && r.Model != "" }

type signedThinking struct {
	Route     ReplayRoute `json:"route"`
	Signature string      `json:"signature"`
}

// ReadSignedStream is the opt-in codec for signed thinking. A signature
// remains opaque; authenticity is for the provider to validate. The current
// HTTP adapter uses ReadStream unless signed thinking is explicitly enabled.
func ReadSignedStream(src io.Reader, route ReplayRoute, emit func(model.StreamChunk) error) (model.Completion, error) {
	if !route.valid() {
		return model.Completion{}, errors.New("messages: signed thinking requires an explicit route")
	}
	return readStream(src, route, emit)
}

func replayThinking(b model.ContentBlock, route ReplayRoute) (requestBlock, bool, error) {
	var replay signedThinking
	if len(b.Extensions) != 1 || json.Unmarshal(b.Extensions[thinkingExtension], &replay) != nil || !replay.Route.valid() || replay.Signature == "" {
		return requestBlock{}, false, errors.New("messages: invalid signed thinking envelope")
	}
	if replay.Route != route {
		return requestBlock{}, false, nil
	}
	return requestBlock{Type: "thinking", Thinking: &b.Text, Signature: replay.Signature}, true, nil
}
