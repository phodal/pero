package tool

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/phodal/pero/harness/go/model"
	"github.com/phodal/pero/harness/go/session"
)

// ReadObservation describes a complete, freshly read native text result.
// Admission (no explicit range, resource instructions or media) belongs to the
// native reader. The content hash prevents modified presentations being reused.
type ReadObservation struct {
	Path          string `json:"path"`
	Digest        string `json:"digest"`
	ContentSHA256 string `json:"content_sha256"`
}
type readReference struct {
	Original uint64 `json:"original_seq"`
	Anchor   uint64 `json:"anchor_seq"`
}
type readMetadata struct {
	Read  *ReadObservation `json:"native_read,omitempty"`
	Reuse *readReference   `json:"read_reuse,omitempty"`
}

// ReusableReadMetadata is minted only for complete unmodified text receipts.
func ReusableReadMetadata(path, digest, text string) json.RawMessage {
	raw, _ := json.Marshal(readMetadata{Read: &ReadObservation{path, digest, diagnosticHash(text)}})
	return raw
}

type reusableRead struct {
	block model.ContentBlock
	meta  readMetadata
	key   ReadObservation
	valid bool
}

func decodeReusableRead(data json.RawMessage) reusableRead {
	var r reusableRead
	if json.Unmarshal(data, &r.block) != nil || r.block.Type != model.BlockToolResult || r.block.IsError || len(r.block.Content) != 1 || r.block.Content[0].Type != model.BlockText {
		return r
	}
	decoder := json.NewDecoder(bytes.NewReader(r.block.Meta))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&r.meta) != nil || r.meta.Read == nil {
		return r
	}
	r.key = *r.meta.Read
	if r.key.Path == "" || r.key.Digest == "" || r.key.ContentSHA256 == "" {
		return r
	}
	r.valid = r.meta.Reuse != nil || diagnosticHash(r.block.Content[0].Text) == r.key.ContentSHA256
	return r
}

// ReadReuse owns request-boundary projection, not filesystem caching. Every
// invocation still reads and hashes the file. Full raw results remain in the
// Session; references are reconciled after pruning/compaction, before a request.
// Memoize only immutable visible result decoding, bounded by the live surface.
type ReadReuse struct{ visible map[uint64]reusableRead }

func (p *ReadReuse) Reconcile(s *session.Session) error {
	events, surface := s.HistorySnapshot()
	next := make(map[uint64]reusableRead)
	anchors := make(map[ReadObservation]uint64)
	for _, seq := range surface {
		event := events[seq-1]
		if event.Type != "tool/result" {
			continue
		}
		r, ok := p.visible[seq]
		if !ok {
			r = decodeReusableRead(event.Data)
		}
		next[seq] = r
		if !r.valid {
			continue
		}
		original := seq
		full := r
		if r.meta.Reuse != nil {
			original = r.meta.Reuse.Original
			if original == 0 || original >= seq || original > uint64(len(events)) || events[original-1].Type != "tool/result" {
				continue
			}
			full = decodeReusableRead(events[original-1].Data)
			if !full.valid || full.meta.Reuse != nil || full.key != r.key || full.block.ToolCallID != r.block.ToolCallID {
				continue
			}
		}
		anchor := anchors[r.key]
		replacement := full.block
		if anchor != 0 {
			reference := readReference{Original: original, Anchor: anchor}
			if r.meta.Reuse != nil && *r.meta.Reuse == reference {
				continue
			}
			replacement.Content = []model.ContentBlock{{Type: model.BlockText, Text: fmt.Sprintf("File %q was read again; its complete content is identical to the earlier visible read at result seq %d. Reuse that content. To retrieve this exact read, use ReadToolOutput locator=%q; an explicit offset/limit forces full output.", r.key.Path, anchor, fmt.Sprintf("%s%s:%d", historyLocatorPrefix, s.Header().ID, original))}}
			if len(replacement.Content[0].Text) >= len(full.block.Content[0].Text) {
				continue
			}
			replacement.Meta, _ = json.Marshal(readMetadata{Read: full.meta.Read, Reuse: &reference})
		} else if r.meta.Reuse == nil {
			anchors[r.key] = seq
			continue
		}
		// No surviving full anchor means restore this result, never leave a dangling
		// claim that a compacted/pruned read is still in the model's context.
		raw, err := json.Marshal(replacement)
		if err != nil {
			return err
		}
		tokens := model.EstimateMessageTokens(model.Message{Role: model.RoleTool, Content: []model.ContentBlock{r.block}})
		committed, err := s.AppendPrunedToolResult(seq, raw, max(1, tokens))
		if err != nil {
			return err
		}
		delete(next, seq)
		next[committed.Seq] = decodeReusableRead(raw)
		if anchor == 0 {
			anchors[r.key] = committed.Seq
		}
	}
	p.visible = next
	return nil
}
