package runref

// Ref identifies an exact execution even when its Task advances to a new generation.
type Ref struct {
	TaskID     string `json:"task_id"`
	RunID      string `json:"run_id"`
	Generation int64  `json:"generation"`
}
