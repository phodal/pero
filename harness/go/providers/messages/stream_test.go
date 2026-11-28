package messages

import (
	"errors"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/model"
)

const start = `{"type":"message_start","message":{"usage":{"input_tokens":7,"output_tokens":1,"cache_read_input_tokens":10,"cache_creation_input_tokens":2}}}`
const stop = `{"type":"message_stop"}`
const toolStart = `{"type":"content_block_start","index":3,"content_block":{"type":"tool_use","id":"call-1","name":"read","input":{}}}`
const toolEnd = `{"type":"content_block_stop","index":3}`
const argumentsPart1 = `{"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"{\"path\":"}}`
const argumentsPart2 = `{"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"\"sample.txt\"}"}}`
const toolFinish = `{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}`
const textStart = `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":"Hello"}}`
const textDelta = `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}`
const textEnd = `{"type":"content_block_stop","index":0}`

func sse(events ...string) string {
	return "data: " + strings.Join(events, "\n\ndata: ") + "\n\n"
}

func TestReadStreamTextAndTool(t *testing.T) {
	var text, args strings.Builder
	wire := ": keepalive\r\n\r\nevent: message_start\r\n" + sse(start, textStart, textDelta, textEnd,
		toolStart, argumentsPart1, argumentsPart2, toolEnd, toolFinish, stop)
	completion, err := ReadStream(strings.NewReader(wire), func(chunk model.StreamChunk) error {
		for _, b := range chunk.Content {
			if b.Type == model.BlockToolCall {
				if b.ToolCallID != "call-1" || b.Arguments != nil {
					t.Fatalf("stream delta exposed an executable call: %+v", b)
				}
				args.WriteString(b.ArgumentsDelta)
			} else if b.Type == model.BlockText {
				text.WriteString(b.Text)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	blocks := completion.Message.Content
	if completion.Finish != model.FinishToolCalls || len(blocks) != 2 || blocks[0].Text != "Hello world" ||
		text.String() != blocks[0].Text || blocks[1].Name != "read" || string(blocks[1].Arguments) != `{"path":"sample.txt"}` ||
		args.String() != string(blocks[1].Arguments) {
		t.Fatalf("completion: %+v", completion)
	}
	if got := *completion.Usage; got.InputTokens != 7 || got.OutputTokens != 4 || got.CacheReadTokens != 10 ||
		got.CacheWriteTokens != 2 || got.TotalTokens != 23 {
		t.Fatalf("usage was not merged: %+v", got)
	}
}

func TestReadStreamTerminalBoundary(t *testing.T) {
	for _, tt := range []struct {
		name, wire string
		incomplete bool
	}{
		{"no terminal frame", sse(start, toolStart, toolEnd, toolFinish), true},
		{"partial terminal frame", sse(start, textStart, textEnd) + "data: " + stop, true},
		{"unclosed block", sse(start, toolStart, toolFinish, stop), true},
		{"tool JSON not complete", sse(start, toolStart, argumentsPart1, toolEnd, toolFinish, stop), false},
		{"tool under ordinary stop", sse(start, toolStart, toolEnd, `{"type":"message_delta","delta":{"stop_reason":"end_turn"}}`, stop), false},
		{"provider error", sse(start, `{"type":"error","error":{"message":"private provider sample"}}`), false},
		{"wrong SSE event name", "event: wrong\n" + sse(start), false},
		{"unsupported thinking", sse(start, `{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"fixture"}}`), false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			completion, err := ReadStream(strings.NewReader(tt.wire), nil)
			if err == nil || errors.Is(err, ErrIncomplete) != tt.incomplete || completion.Finish != "" ||
				len(completion.Message.Content) != 0 || strings.Contains(err.Error(), "private provider sample") {
				t.Fatalf("completion=%+v err=%v", completion, err)
			}
		})
	}
	for stopReason, finish := range map[string]model.FinishKind{"max_tokens": model.FinishMaxTokens, "refusal": model.FinishRefusal} {
		t.Run(stopReason, func(t *testing.T) {
			completion, err := ReadStream(strings.NewReader(sse(start, toolStart, argumentsPart1, toolEnd,
				`{"type":"message_delta","delta":{"stop_reason":"`+stopReason+`"},"usage":{"output_tokens":5}}`, stop)), nil)
			if err != nil || completion.Finish != finish || len(completion.Message.Content) != 0 ||
				completion.Usage == nil || completion.Usage.OutputTokens != 5 {
				t.Fatalf("completion=%+v err=%v", completion, err)
			}
		})
	}
	sentinel := errors.New("observer cancelled")
	if _, err := ReadStream(strings.NewReader(sse(start, textStart)), func(model.StreamChunk) error { return sentinel }); !errors.Is(err, sentinel) {
		t.Fatalf("observer error lost: %v", err)
	}
}
