package harness

import harnessllm "github.com/phodal/pero/harness/go/llm"

const (
	ContextWindowExceededCode  = harnessllm.ContextWindowExceededCode
	EmptyResponseCode          = harnessllm.EmptyResponseCode
	MalformedResponseCode      = harnessllm.MalformedResponseCode
	StreamClosedCode           = harnessllm.StreamClosedCode
	TransportErrorCode         = harnessllm.TransportErrorCode
	RequestBudgetExhaustedCode = harnessllm.RequestBudgetExhaustedCode
	ImageOffloadRequiredCode   = harnessllm.ImageOffloadRequiredCode
)

type ProviderFailure = harnessllm.ProviderFailure
type ProviderError = harnessllm.ProviderError

func NewProviderError(message, code string, cause error) *ProviderError {
	return harnessllm.NewProviderError(message, code, cause)
}

// NewProviderErrorWithFailure retains structured provider response facts for
// retry policy and diagnostics without exposing the live cause to persistence.
func NewProviderErrorWithFailure(failure ProviderFailure, cause error) *ProviderError {
	return harnessllm.NewProviderErrorWithFailure(failure, cause)
}

// NewImageOffloadRequired builds the route failure that names how many more
// oldest retained input images must be omitted.
func NewImageOffloadRequired(count int) *ProviderError {
	return harnessllm.NewImageOffloadRequired(count)
}

func ProviderFailureFromError(err error) ProviderFailure {
	return harnessllm.ProviderFailureFromError(err)
}

// IsContextWindowExceededDetail recognizes explicit provider wording about a
// model context bound. It intentionally does not classify generic HTTP 400s.
func IsContextWindowExceededDetail(detail string) bool {
	return harnessllm.IsContextWindowExceededDetail(detail)
}
