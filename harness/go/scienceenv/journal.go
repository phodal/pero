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
	CellUnknown     CellStatus = "unknown"
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

// CellReceipt is stored in the existing Agent log before and after execution.
type CellReceipt struct {
	Language Language `json:"language"`
	Cell     Cell     `json:"cell"`
}

// Journal owns the observable computation transition. It performs no I/O.
type Journal struct {
	Status     KernelStatus
	Generation int
	History    []Cell
	Error      string
}

// restore folds saved receipts without restoring an interpreter or replaying
// code. A missing final receipt is an unknown outcome, never a claimed failure.
func (j Journal) restore(cell Cell) Journal {
	if cell.Status == CellRunning {
		cell.Status = CellUnknown
		cell.Error = "Session stopped before a completion receipt. Variables were not restored; review file effects before rerunning."
	}
	j.History = append([]Cell(nil), j.History...)
	index := cell.ID - 1
	if index >= 0 && index < len(j.History) {
		j.History[index] = cell
	} else {
		j.History = append(j.History, cell)
	}
	j.Generation = cell.Generation
	return j
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
