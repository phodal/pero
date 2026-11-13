package scienceenv

import "errors"

// KernelStatus distinguishes interpreter availability from the outcome of a cell.
type KernelStatus string

const (
	KernelClosed      KernelStatus = "closed"
	KernelIdle        KernelStatus = "idle"
	KernelRunning     KernelStatus = "running"
	KernelUnavailable KernelStatus = "unavailable"
)

type CellStatus string

const (
	CellRunning     CellStatus = "running"
	CellCompleted   CellStatus = "completed"
	CellFailed      CellStatus = "failed"
	CellInterrupted CellStatus = "interrupted"
)

// CellOrigin records who submitted code to the one session-owned interpreter.
type CellOrigin string

const (
	AgentCell CellOrigin = "agent"
	UserCell  CellOrigin = "user"
)

// NotebookOutput is the nbformat stream/error projection of a kernel result.
type NotebookOutput struct {
	Type      string   `json:"output_type"`
	Name      string   `json:"name,omitempty"`
	Text      string   `json:"text,omitempty"`
	Traceback []string `json:"traceback,omitempty"`
	EName     string   `json:"ename,omitempty"`
	EValue    string   `json:"evalue,omitempty"`
}

// Cell is a retained execution receipt. Restarting discards variables, not receipts.
type Cell struct {
	ID             int              `json:"id"`
	Origin         CellOrigin       `json:"origin"`
	Code           string           `json:"code"`
	Status         CellStatus       `json:"status"`
	Generation     int              `json:"generation"`
	Outputs        []NotebookOutput `json:"outputs"`
	ExecutionCount int              `json:"execution_count"`
	Error          string           `json:"error"`
}

// Journal owns the observable computation transition. It performs no I/O.
type Journal struct {
	Status     KernelStatus
	Generation int
	History    []Cell
	Error      string
}

func (j Journal) begin(code string, origin CellOrigin) (Journal, error) {
	if j.Status == "running" {
		return j, errors.New("Kernel is busy; wait or interrupt the running cell")
	}
	if j.Status != "idle" {
		return j, errors.New("Start or restart the kernel before running a cell")
	}
	j.History = append(append([]Cell(nil), j.History...), Cell{
		ID: len(j.History) + 1, Origin: origin, Code: code, Status: "running",
		Generation: j.Generation, ExecutionCount: len(j.History) + 1, Outputs: []NotebookOutput{},
	})
	j.Status, j.Error = "running", ""
	return j, nil
}

func (j Journal) finish(out Output, executionError error, interrupted bool) Journal {
	j.History = append([]Cell(nil), j.History...)
	cell := &j.History[len(j.History)-1]
	cell.Status = "completed"
	cell.Error = out.Error
	if out.Stdout != "" {
		cell.Outputs = append(cell.Outputs, NotebookOutput{Type: "stream", Name: "stdout", Text: out.Stdout})
	}
	if out.Stderr != "" {
		cell.Outputs = append(cell.Outputs, NotebookOutput{Type: "stream", Name: "stderr", Text: out.Stderr})
	}
	if executionError != nil {
		cell.Error = executionError.Error()
	}
	j.Status = "idle"
	if cell.Error != "" {
		cell.Status = "failed"
		cell.Outputs = append(cell.Outputs, NotebookOutput{Type: "error", EName: "ExecutionError", EValue: cell.Error, Traceback: []string{cell.Error}})
	}
	if executionError != nil {
		// The existing Kernel cancellation contract kills the process. Never
		// silently start a fresh process under a presentation of retained state.
		j.Status = "closed"
	}
	if interrupted {
		cell.Status = "interrupted"
	}
	j.Error = cell.Error
	return j
}
