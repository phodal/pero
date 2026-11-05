package nativetools

import "github.com/phodal/pero/harness/go/fstools"

// reusableReadWindow is admitted only by native text reads without explicit
// ranges or plugin resources. Media and incomplete reads never carry this type.
type reusableReadWindow struct{ fstools.ReadWindow }

func nativeReadResult(window fstools.ReadWindow, offset, limit int, resource string) any {
	if offset == 0 && limit == 0 && resource == "" && window.Offset == 1 && !window.Truncated && window.NextOffset == 0 {
		return reusableReadWindow{window}
	}
	return window
}
