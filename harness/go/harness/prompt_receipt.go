package harness

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
)

type promptReceiptIDKey struct{}
type promptReceiptSeqKey struct{}

// WithPromptReceiptID correlates an admitted host turn with local model requests.
// It supplies no authorization and is never sent to the model.
func WithPromptReceiptID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, promptReceiptIDKey{}, id)
}

func promptReceiptID(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	id, _ := ctx.Value(promptReceiptIDKey{}).(string)
	return id
}

// PromptReceiptLink identifies the native request behind an adapter receipt.
// Auxiliary or independently dispatched calls do not have this link.
func PromptReceiptLink(ctx context.Context) (id string, seq uint64) {
	seq, _ = ctx.Value(promptReceiptSeqKey{}).(uint64)
	if seq != 0 {
		id = promptReceiptID(ctx)
	}
	return id, seq
}

type promptFingerprint struct {
	SHA256 string `json:"sha256"`
	Bytes  int    `json:"bytes"`
}

type promptSectionReceipt struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	promptFingerprint
}

type promptBlockReceipt struct {
	Type BlockType `json:"type"`
	promptFingerprint
}

type promptMessageReceipt struct {
	ID     string               `json:"id,omitempty"`
	Role   Role                 `json:"role"`
	Blocks []promptBlockReceipt `json:"blocks"`
	promptFingerprint
}

type promptToolReceipt struct {
	ID string `json:"id"`
	promptFingerprint
}

// promptRequestReceipt describes the request after common Harness projection.
// An adapter can separately record the encoded payload with PromptReceiptLink.
type promptRequestReceipt struct {
	owner            *Agent
	PromptID         string                 `json:"promptId,omitempty"`
	Turn             int                    `json:"turn"`
	Step             int                    `json:"step"`
	Attempt          int                    `json:"attempt"`
	Purpose          string                 `json:"purpose"`
	Stage            string                 `json:"stage"`
	Provider         string                 `json:"provider"`
	Model            string                 `json:"model"`
	AfterSeq         uint64                 `json:"afterSeq"`
	System           *promptFingerprint     `json:"system,omitempty"`
	SystemOverridden bool                   `json:"systemOverridden,omitempty"`
	Sections         []promptSectionReceipt `json:"sections"`
	Messages         []promptMessageReceipt `json:"messages"`
	Tools            []promptToolReceipt    `json:"tools"`
}

func fingerprintPrompt(raw []byte) promptFingerprint {
	return promptFingerprint{SHA256: fmt.Sprintf("sha256:%x", sha256.Sum256(raw)), Bytes: len(raw)}
}

func fingerprintPromptJSON(value any) (promptFingerprint, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return promptFingerprint{}, fmt.Errorf("harness: fingerprint prompt input: %w", err)
	}
	return fingerprintPrompt(raw), nil
}

func recordPromptReceipt(ctx context.Context, request GenerateRequest) (context.Context, error) {
	receipt := *request.promptReceipt
	if request.System != "" {
		fingerprint := fingerprintPrompt([]byte(request.System))
		receipt.System = &fingerprint
	}
	receipt.Messages = make([]promptMessageReceipt, 0, len(request.Messages))
	for _, message := range request.Messages {
		fingerprint, err := fingerprintPromptJSON(message)
		if err != nil {
			return ctx, err
		}
		entry := promptMessageReceipt{ID: message.ID, Role: message.Role, Blocks: make([]promptBlockReceipt, 0, len(message.Content)), promptFingerprint: fingerprint}
		for _, block := range message.Content {
			fingerprint, err := fingerprintPromptJSON(block)
			if err != nil {
				return ctx, err
			}
			entry.Blocks = append(entry.Blocks, promptBlockReceipt{Type: block.Type, promptFingerprint: fingerprint})
		}
		receipt.Messages = append(receipt.Messages, entry)
	}
	if receipt.Sections == nil {
		receipt.Sections = []promptSectionReceipt{}
	}
	receipt.Tools = make([]promptToolReceipt, 0, len(request.Tools))
	for _, tool := range request.Tools {
		fingerprint, err := fingerprintPromptJSON(tool)
		if err != nil {
			return ctx, err
		}
		receipt.Tools = append(receipt.Tools, promptToolReceipt{ID: tool.Name, promptFingerprint: fingerprint})
	}
	event, err := receipt.owner.Session().Append("request/prompt-receipt", receipt)
	if err != nil {
		return ctx, err
	}
	if err := receipt.owner.checkpoint(ctx); err != nil {
		return ctx, err
	}
	return context.WithValue(ctx, promptReceiptSeqKey{}, event.Seq), nil
}
