package harness

// Tool-call lineage is retained independently from optional background jobs.
type toolCallLineageKey struct{}
type toolCallLineage struct {
	owner      *Agent
	token      ToolExecutionToken
	rootCallID ToolCallID
	nextStep   *nextStepReport
}
