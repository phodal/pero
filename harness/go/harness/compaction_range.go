package harness

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"

	"github.com/phodal/pero/harness/go/tool"
)

type compactionSelection struct {
	startIndex int
	endIndex   int
	rangeValue SurfaceRange
	seqs       []uint64
	tokens     int
}

var errCompactionNoReduction = errors.New("harness: compaction summary did not shrink the selected history")

func selectCompactionRange(measurement TokenMeasurement, retainTokens int) *compactionSelection {
	nodes := measurement.Nodes
	startIndex := 0
	protected := -1
	for index, node := range nodes {
		if node.Message.Role == RoleSystem {
			protected = index
			break
		}
	}
	if protected == 0 {
		startIndex = 1
	}
	if len(nodes)-startIndex < 2 {
		return nil
	}
	accumulated := 0
	keepFrom := len(nodes)
	for index := len(nodes) - 1; index >= 0; index-- {
		accumulated += nodes[index].Tokens
		keepFrom = index
		if accumulated >= retainTokens {
			break
		}
	}
	if keepFrom <= startIndex {
		return nil
	}
	endIndex := keepFrom - 1
	if protected > 0 && endIndex >= protected {
		endIndex = protected - 1
	}
	for endIndex >= startIndex && !toolPairsBalanced(nodes[startIndex:endIndex+1]) {
		endIndex--
	}
	if endIndex < startIndex {
		return nil
	}
	selection := &compactionSelection{startIndex: startIndex, endIndex: endIndex}
	selection.rangeValue = SurfaceRange{Start: nodes[startIndex].Seq, End: nodes[endIndex].Seq}
	for _, node := range nodes[startIndex : endIndex+1] {
		selection.seqs = append(selection.seqs, node.Seq)
		selection.tokens += node.Tokens
	}
	return selection
}

func selectExplicitCompactionRange(measurement TokenMeasurement, start, end uint64) (*compactionSelection, error) {
	startIndex, endIndex := -1, -1
	for index, node := range measurement.Nodes {
		if node.Seq == start {
			startIndex = index
		}
		if node.Seq == end {
			endIndex = index
		}
	}
	if startIndex < 0 {
		return nil, fmt.Errorf("harness: compactRegion start seq %d not found in surface", start)
	}
	if endIndex < 0 {
		return nil, fmt.Errorf("harness: compactRegion end seq %d not found in surface", end)
	}
	if startIndex > endIndex {
		return nil, fmt.Errorf("harness: compactRegion start seq %d (position %d) is after end seq %d (position %d) on the surface", start, startIndex, end, endIndex)
	}
	for index, node := range measurement.Nodes {
		if node.Message.Role != RoleSystem {
			continue
		}
		if startIndex <= index && index <= endIndex {
			return nil, fmt.Errorf("harness: compaction must preserve the system prompt head")
		}
		break
	}
	if !toolPairsBalanced(measurement.Nodes[:startIndex]) {
		return nil, fmt.Errorf("harness: compactRegion start seq %d is not a balanced boundary", start)
	}
	if !toolPairsBalanced(measurement.Nodes[:endIndex+1]) {
		return nil, fmt.Errorf("harness: compactRegion end seq %d is not a balanced boundary", end)
	}
	selection := &compactionSelection{
		startIndex: startIndex,
		endIndex:   endIndex,
		rangeValue: SurfaceRange{Start: start, End: end},
	}
	for _, node := range measurement.Nodes[startIndex : endIndex+1] {
		selection.seqs = append(selection.seqs, node.Seq)
		selection.tokens += node.Tokens
	}
	return selection, nil
}

func toolPairsBalanced(nodes []TokenNode) bool {
	pending := make(map[ToolCallID]struct{})
	for _, node := range nodes {
		for _, block := range node.Message.Content {
			switch block.Type {
			case BlockToolCall:
				if block.ToolCallID == "" {
					return false
				}
				pending[block.ToolCallID] = struct{}{}
			case BlockToolResult:
				if _, ok := pending[block.ToolCallID]; !ok {
					return false
				}
				delete(pending, block.ToolCallID)
			}
		}
	}
	return len(pending) == 0
}

func (b *BasicCompactor) compactRange(ctx context.Context, agent *Agent, measurement TokenMeasurement, selection compactionSelection, turn *int, sourceCommandID *CommandID, instructions string, policy resolvedTargetCompactionPolicy) (result *CompactionResult, err error) {
	session := agent.session
	releaseCompaction, acquired := session.TryLockCompaction()
	if !acquired {
		if turn == nil {
			return nil, newManualCompactionError(ManualCompactionBusy, "manual compaction found an active compaction", nil)
		}
		return nil, errors.New("harness: compaction is already active")
	}
	defer releaseCompaction()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	active, err := inspectCompactionLog(session.Events())
	if err != nil {
		return nil, err
	}
	if active {
		if turn == nil {
			return nil, newManualCompactionError(ManualCompactionBusy, "manual compaction found an open durable bracket", nil)
		}
		return nil, errors.New("harness: durable compaction bracket is already open")
	}
	openTurn, err := inspectOpenTurn(session.Events())
	if err != nil {
		return nil, err
	}
	if turn == nil && openTurn != nil {
		return nil, newManualCompactionError(ManualCompactionBusy, "manual compaction found an open turn", nil)
	}
	if turn != nil && (openTurn == nil || *openTurn != *turn) {
		return nil, errors.New("harness: automatic compaction requires its current open turn")
	}
	hookInput := CompactionHookInput{Agent: agent, Trigger: "auto", CustomInstructions: strings.TrimSpace(instructions)}
	if turn == nil {
		hookInput.Trigger = "manual"
	}
	hookInput, hookErr := agent.hooks.PreCompact.Run(ctx, hookInput, func(_ context.Context, input CompactionHookInput) (CompactionHookInput, error) { return input, nil })
	if hookErr != nil {
		return nil, hookErr
	}
	if hookInput.Reject {
		return nil, fmt.Errorf("harness: compaction blocked: %s", hookInput.Reason)
	}
	beforeNodes := append([]TokenNode(nil), measurement.Nodes...)
	selectedNodes := append([]TokenNode(nil), measurement.Nodes[selection.startIndex:selection.endIndex+1]...)
	compactionID, err := newCompactionID()
	if err != nil {
		return nil, err
	}
	start, err := session.Append("compaction/start", struct {
		CompactionID    string     `json:"compactionId"`
		SourceCommandID *CommandID `json:"sourceCommandId,omitempty"`
		Turn            *int       `json:"turn"`
	}{compactionID, sourceCommandID, turn})
	if err != nil {
		if turn == nil {
			return nil, newManualCompactionError(ManualCompactionCommit, "manual compaction could not start", err)
		}
		return nil, err
	}
	closed := false
	closing := false
	defer func() {
		if !closed && !closing {
			closing = true
			payload := struct {
				CompactionID    string     `json:"compactionId"`
				SourceCommandID *CommandID `json:"sourceCommandId,omitempty"`
				Turn            *int       `json:"turn"`
				Error           string     `json:"error,omitempty"`
			}{CompactionID: compactionID, SourceCommandID: sourceCommandID, Turn: turn}
			if err != nil {
				payload.Error = err.Error()
			} else {
				payload.Error = "compaction did not commit"
			}
			_, closeErr := session.Append("compaction/end", payload)
			if closeErr == nil {
				closed = true
			} else if turn == nil {
				result = nil
				err = newManualCompactionError(ManualCompactionCommit, "manual compaction could not close", closeErr)
			} else {
				err = errors.Join(err, closeErr)
			}
		}
		if turn == nil && closed {
			if flushErr := session.Flush(context.WithoutCancel(ctx)); flushErr != nil && err == nil {
				result = nil
				err = newManualCompactionError(
					ManualCompactionPersistence,
					"manual compaction durability checkpoint failed",
					flushErr,
				)
			}
		}
	}()

	summary, rawOutput, usage, provider, model, err := b.summarize(ctx, agent, compactionID, measurement, selection, policy)
	if err != nil {
		if turn == nil && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			return nil, newManualCompactionError(ManualCompactionSummary, "manual compaction summary failed", err)
		}
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	currentMeasurement, measureErr := b.meter.Measure(session)
	if measureErr != nil {
		return nil, measureErr
	}
	// An image/offload recorded while summarizing changes derived image marks
	// without moving the selected surface nodes. Those marks must not look
	// like an unrelated surface edit.
	stable := reflect.DeepEqual(measurementNodesIgnoringImageOffload(beforeNodes), measurementNodesIgnoringImageOffload(currentMeasurement.Nodes))
	if turn == nil {
		currentSelection, selectionErr := selectExplicitCompactionRange(currentMeasurement, selection.rangeValue.Start, selection.rangeValue.End)
		stable = selectionErr == nil && reflect.DeepEqual(selection.seqs, currentSelection.seqs) &&
			reflect.DeepEqual(
				measurementNodesIgnoringImageOffload(selectedNodes),
				measurementNodesIgnoringImageOffload(currentMeasurement.Nodes[currentSelection.startIndex:currentSelection.endIndex+1]),
			)
	}
	if !stable {
		if turn == nil {
			return nil, newManualCompactionError(ManualCompactionChanged, "manual compaction surface changed", nil)
		}
		return nil, errors.New("harness: compaction surface changed while summarization was running")
	}
	fileOperations := checkpointFileOperations(session.Events(), selection.rangeValue.End)
	if len(fileOperations) > 0 {
		raw, _ := json.Marshal(fileOperations)
		summary = append(summary, ContentBlock{Type: BlockText, Text: "Observed file operations (bounded recent records; not current-content verification):\n" + string(raw)})
	}
	checkpoint := frameCompactionSummary(summary)
	if EstimateMessageTokens(Message{Role: RoleUser, Content: checkpoint}) >= selection.tokens {
		if turn == nil {
			return nil, newManualCompactionError(ManualCompactionSummary, "manual compaction summary did not shrink history", nil)
		}
		return nil, errCompactionNoReduction
	}
	summaryEvent, err := session.Append("compaction/summary", struct {
		CompactionID       string                    `json:"compactionId"`
		SourceCommandID    *CommandID                `json:"sourceCommandId,omitempty"`
		Summary            []ContentBlock            `json:"summary"`
		RawOutput          []ContentBlock            `json:"rawOutput"`
		LLMStreamCall      bool                      `json:"llmStreamCall"`
		ShadowedRange      SurfaceRange              `json:"shadowedRange"`
		ShadowedSeqs       []uint64                  `json:"shadowedSeqs"`
		ShadowedTokenCount int                       `json:"shadowedTokenCount"`
		Provider           string                    `json:"provider"`
		Model              string                    `json:"model"`
		MaxTokens          int                       `json:"maxTokens"`
		Usage              *TokenUsage               `json:"usage,omitempty"`
		FileOperations     []checkpointFileOperation `json:"fileOperations,omitempty"`
	}{
		CompactionID: compactionID, SourceCommandID: sourceCommandID, Summary: summary, RawOutput: rawOutput, LLMStreamCall: true,
		ShadowedRange: selection.rangeValue, ShadowedSeqs: selection.seqs, ShadowedTokenCount: selection.tokens,
		Provider: provider, Model: model, MaxTokens: policy.maxTokens, Usage: usage,
		FileOperations: fileOperations,
	})
	if err != nil {
		if turn == nil {
			return nil, newManualCompactionError(ManualCompactionCommit, "manual compaction could not commit its summary", err)
		}
		return nil, err
	}
	sources := make([]uint64, 0, len(selection.seqs)+2)
	sources = append(sources, start.Seq, summaryEvent.Seq)
	sources = append(sources, selection.seqs...)
	checkpointEvent := struct {
		Message
		Source struct {
			Kind            string     `json:"kind"`
			Plugin          string     `json:"plugin"`
			CompactionID    string     `json:"compactionId"`
			SourceCommandID *CommandID `json:"sourceCommandId,omitempty"`
		} `json:"source"`
	}{Message: Message{Role: RoleUser, Content: checkpoint}}
	checkpointEvent.Source.Kind = "plugin"
	checkpointEvent.Source.Plugin = "compact"
	checkpointEvent.Source.CompactionID = compactionID
	checkpointEvent.Source.SourceCommandID = sourceCommandID
	if _, err := session.AppendReplacement("user/message", checkpointEvent, selection.rangeValue, sources); err != nil {
		if turn == nil {
			return nil, newManualCompactionError(ManualCompactionCommit, "manual compaction could not replace history", err)
		}
		return nil, err
	}
	closing = true
	endEvent, err := session.Append("compaction/end", struct {
		CompactionID    string     `json:"compactionId"`
		SourceCommandID *CommandID `json:"sourceCommandId,omitempty"`
		Turn            *int       `json:"turn"`
	}{compactionID, sourceCommandID, turn})
	if err != nil {
		if turn == nil {
			return nil, newManualCompactionError(ManualCompactionCommit, "manual compaction could not close", err)
		}
		return nil, err
	}
	closed = true
	hookInput.CompactSummary = compactionSummaryText(summary)
	hookInput, hookErr = agent.hooks.PostCompact.Run(ctx, hookInput, func(_ context.Context, input CompactionHookInput) (CompactionHookInput, error) { return input, nil })
	if hookErr != nil {
		return nil, hookErr
	}
	for _, message := range hookInput.Messages {
		if message.Role != RoleUser || len(message.Source) == 0 {
			return nil, errors.New("harness: post-compaction context requires synthetic user messages with a source")
		}
	}
	for _, message := range hookInput.Messages {
		if _, err := session.AppendSurface("user/message", message, []uint64{endEvent.Seq}); err != nil {
			return nil, fmt.Errorf("harness: append post-compaction context: %w", err)
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return &CompactionResult{
		CompactionID: compactionID, SourceCommandID: commandIDValue(sourceCommandID), StartSeq: start.Seq, SummarySeq: summaryEvent.Seq, EndSeq: endEvent.Seq,
		Summary: summary, ShadowedRange: selection.rangeValue, ShadowedSeqs: append([]uint64(nil), selection.seqs...),
		ShadowedTokenCount: selection.tokens,
	}, nil
}

func (b *BasicCompactor) summarize(ctx context.Context, agent *Agent, compactionID string, measurement TokenMeasurement, selection compactionSelection, policy resolvedTargetCompactionPolicy) (
	summary []ContentBlock, raw []ContentBlock, usage *TokenUsage, provider string, model string, err error,
) {
	header, _, err := agent.session.RequestHeader()
	if err != nil {
		return nil, nil, nil, "", "", err
	}
	provider, model = policy.summarizationProvider, policy.summarizationModel
	if provider == "" {
		provider, model = header.Provider, header.Model
	}
	if provider == "" {
		provider, model = agent.provider, agent.model
	}
	if provider == "" || model == "" {
		return nil, nil, nil, "", "", errors.New("harness: no provider/model available for compaction summarization")
	}
	messages := make([]Message, 0, selection.endIndex-selection.startIndex+2)
	for _, node := range measurement.Nodes[selection.startIndex : selection.endIndex+1] {
		messages = append(messages, cloneMessage(node.Message))
	}
	messages = tool.ExpandReadReferences(agent.session, selection.seqs, messages)
	messages = append(messages, Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: compactionInstruction}}})
	system, err := agent.session.EffectiveSystemPrompt()
	if err != nil {
		return nil, nil, nil, "", "", err
	}
	request := GenerateRequest{
		Provider: provider, Model: model, System: system, Messages: messages,
		Tools: append([]ToolSchema(nil), header.Tools...), MaxTokens: policy.maxTokens, Purpose: "compaction", Agent: agent,
		Attachments: agent.attachments,
	}
	request, err = agent.hooks.Request.Run(ctx, request, func(_ context.Context, value GenerateRequest) (GenerateRequest, error) { return value, nil })
	if err != nil {
		return nil, nil, nil, "", "", err
	}
	if agent.tools.deferredForAgent(agent) {
		// Summarization does not execute tool calls. Historical headers may
		// contain withdrawn registrations, so do not redeclare those schemas.
		request.Tools = nil
	}
	var completion Completion
	for {
		if err := ctx.Err(); err != nil {
			return nil, nil, nil, "", "", err
		}
		completion, err = agent.adapter.Generate(ctx, request, func(StreamChunk) error { return nil })
		if err == nil {
			break
		}
		if ctx.Err() != nil {
			return nil, nil, nil, "", "", ctx.Err()
		}
		failure := ProviderFailureFromError(err)
		if failure.Code != ImageOffloadRequiredCode || failure.OffloadImages == nil {
			return nil, nil, nil, "", "", err
		}
		recorded, recordErr := agent.session.OffloadOldestImages(selection.seqs, *failure.OffloadImages)
		if recordErr != nil {
			return nil, nil, nil, "", "", recordErr
		}
		if !recorded {
			return nil, nil, nil, "", "", err
		}
		refreshed, refreshErr := agent.session.ProjectedSurfaceMessages(selection.seqs)
		if refreshErr != nil {
			return nil, nil, nil, "", "", refreshErr
		}
		refreshed = tool.ExpandReadReferences(agent.session, selection.seqs, refreshed)
		request.Messages = append(refreshed, Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: compactionInstruction}}})
	}
	// Provider usage belongs to the completed request even when its summary is
	// truncated, rejected or too large to replace the selected history.
	if _, err := agent.session.Append("compaction/response", struct {
		CompactionID string      `json:"compactionId"`
		Provider     string      `json:"provider"`
		Model        string      `json:"model"`
		Finish       FinishKind  `json:"finish"`
		Usage        *TokenUsage `json:"usage"`
		ToolCount    int         `json:"toolCount"`
	}{compactionID, provider, model, completion.Finish, completion.Usage, len(request.Tools)}); err != nil {
		return nil, nil, nil, "", "", err
	}
	if completion.Finish == FinishMaxTokens {
		return nil, nil, nil, "", "", errors.New("harness: compaction summary was truncated at max tokens")
	}
	if completion.Finish == FinishError || completion.Finish == FinishAborted || completion.Finish == FinishRefusal {
		return nil, nil, nil, "", "", fmt.Errorf("harness: compaction summarization ended with %s", completion.Finish)
	}
	raw = append([]ContentBlock(nil), completion.Message.Content...)
	for _, block := range raw {
		switch block.Type {
		case BlockText:
			if strings.TrimSpace(block.Text) != "" {
				summary = append(summary, block)
			}
		case BlockImage:
			return nil, nil, nil, "", "", errors.New("harness: compaction summary cannot contain image output")
		case BlockToolCall, BlockToolResult:
			return nil, nil, nil, "", "", errors.New("harness: compaction summary cannot contain tool activity")
		}
	}
	if len(summary) == 0 {
		return nil, nil, nil, "", "", errors.New("harness: compaction summarization produced no text")
	}
	return summary, raw, completion.Usage, provider, model, nil
}

func measurementNodesIgnoringImageOffload(nodes []TokenNode) []TokenNode {
	cloned := make([]TokenNode, len(nodes))
	for index, node := range nodes {
		cloned[index] = node
		cloned[index].Message.Content = contentWithoutImageOffload(node.Message.Content)
		// The heuristic ignores the offload mark. Strip it before comparing
		// messages, and recompute tokens from that unmarked message.
		cloned[index].Tokens = EstimateMessageTokens(cloned[index].Message)
	}
	return cloned
}

func contentWithoutImageOffload(blocks []ContentBlock) []ContentBlock {
	if blocks == nil {
		return nil
	}
	next := make([]ContentBlock, len(blocks))
	for index, block := range blocks {
		block.Offloaded = false
		block.Content = contentWithoutImageOffload(block.Content)
		next[index] = block
	}
	return next
}

func newCompactionID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", fmt.Errorf("harness: create compaction id: %w", err)
	}
	return hex.EncodeToString(value[:]), nil
}

func commandIDValue(value *CommandID) CommandID {
	if value == nil {
		return ""
	}
	return *value
}

func compactionSummaryText(blocks []ContentBlock) string {
	var text strings.Builder
	for _, block := range blocks {
		if block.Type != BlockText || block.Text == "" {
			continue
		}
		if text.Len() > 0 {
			text.WriteByte('\n')
		}
		text.WriteString(block.Text)
	}
	return text.String()
}

func frameCompactionSummary(summary []ContentBlock) []ContentBlock {
	result := make([]ContentBlock, 0, len(summary)+2)
	result = append(result, ContentBlock{Type: BlockText, Text: compactionCheckpointPreamble + "\n\n<compacted-summary>"})
	// This is a new user checkpoint. Assistant protocol metadata remains in
	// the audited summary, but cannot acquire user-message authority here.
	for _, block := range summary {
		result = append(result, ContentBlock{Type: BlockText, Text: block.Text})
	}
	result = append(result, ContentBlock{Type: BlockText, Text: "</compacted-summary>"})
	return result
}
