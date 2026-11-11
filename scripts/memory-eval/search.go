// Evaluation-only JSONL bridge to the exact search_files implementation owner.
// Build from harness/go; this is not registered as a product tool or service.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/phodal/pero/harness/go/fstools"
)

type query struct {
	Root string `json:"root"`
	Text string `json:"text"`
}
type result struct {
	Reads     []fstools.ReadWindow `json:"reads"`
	Search    fstools.SearchResult `json:"search"`
	Error     string               `json:"error,omitempty"`
	ElapsedNS int64                `json:"elapsed_ns"`
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var q query
		if err := json.Unmarshal(scanner.Bytes(), &q); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		start := time.Now()
		w, err := fstools.OpenWorkspace(q.Root)
		var out result
		if err == nil {
			out.Search, err = w.Search(context.Background(), ".", q.Text)
			if err == nil {
				for _, match := range out.Search.Matches[:min(len(out.Search.Matches), 20)] {
					text, readErr := w.Read(context.Background(), match.Path)
					if readErr != nil {
						err = readErr
						break
					}
					window, readErr := fstools.FormatRead(text, match.Line, 1)
					if readErr != nil {
						err = readErr
						break
					}
					out.Reads = append(out.Reads, window)
				}
			}
			closeErr := w.Close()
			if err == nil {
				err = closeErr
			}
		}
		if err != nil {
			out.Error = err.Error()
		}
		out.ElapsedNS = time.Since(start).Nanoseconds()
		if err := encoder.Encode(out); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
	if err := scanner.Err(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
