package tool

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestRetainedSpillQuotaSharesTextProcessesAndReopenedStores(t *testing.T) {
	root := filepath.Join(t.TempDir(), "spill")
	store := NewLocalSpillStoreWithOptions(LocalSpillStoreOptions{Root: root, SessionMaxBytes: 64})
	owner := SpillOwner{SessionID: "owner"}
	save := SaveTextSpill{Owner: owner, Source: SpillSource{ToolName: "sample", CallID: "one", Label: "sample"}, SuggestedName: "sample.txt", Content: strings.Repeat("a", 16)}
	retained, err := store.SaveText(t.Context(), save)
	if err != nil {
		t.Fatal(err)
	}
	process, err := store.OpenProcessSpill(t.Context(), owner, "process")
	if err != nil {
		t.Fatal(err)
	}
	if n, err := process.Write([]byte(strings.Repeat("b", 80))); n != 48 || !errors.Is(err, ErrSpillQuota) {
		t.Fatalf("write=%d %v", n, err)
	}
	if err := process.Close(); err != nil {
		t.Fatal(err)
	}
	reopened := NewLocalSpillStoreWithOptions(LocalSpillStoreOptions{Root: root, SessionMaxBytes: 64})
	save.Content = "c"
	if _, err := reopened.SaveText(t.Context(), save); !errors.Is(err, ErrSpillQuota) {
		t.Fatalf("reopened store forgot retained files: %v", err)
	}
	lookup, err := reopened.LookupText(t.Context(), owner, retained.Locator, 64)
	if err != nil || lookup.Read == nil || lookup.Read.Text != strings.Repeat("a", 16) {
		t.Fatalf("retained text lost: %+v %v", lookup, err)
	}
	if err := process.Abort(); err != nil {
		t.Fatal(err)
	}
	save.Content = strings.Repeat("c", 48)
	if _, err := reopened.SaveText(t.Context(), save); err != nil {
		t.Fatalf("abort did not release quota: %v", err)
	}
	save.Owner.SessionID = "other"
	if _, err := reopened.SaveText(t.Context(), save); err != nil {
		t.Fatalf("quota crossed session owners: %v", err)
	}
}

func TestRetainedSpillQuotaSerializesConcurrentStoreWriters(t *testing.T) {
	root := filepath.Join(t.TempDir(), "spill")
	stores := []*LocalSpillStore{
		NewLocalSpillStoreWithOptions(LocalSpillStoreOptions{Root: root, SessionMaxBytes: 256}),
		NewLocalSpillStoreWithOptions(LocalSpillStoreOptions{Root: root, SessionMaxBytes: 256}),
	}
	owner := SpillOwner{SessionID: "concurrent"}
	start := make(chan struct{})
	var writers sync.WaitGroup
	for index := range 24 {
		writers.Add(1)
		go func(index int) {
			defer writers.Done()
			<-start
			store := stores[index%len(stores)]
			var err error
			if index%2 == 0 {
				_, err = store.SaveText(t.Context(), SaveTextSpill{Owner: owner, Source: SpillSource{ToolName: "sample", CallID: "many", Label: "sample"}, SuggestedName: "sample.txt", Content: strings.Repeat("x", 32)})
			} else {
				var process ProcessSpill
				process, err = store.OpenProcessSpill(t.Context(), owner, "sample")
				if err == nil {
					_, err = process.Write([]byte(strings.Repeat("y", 32)))
					err = errors.Join(err, process.Close())
				}
			}
			if err != nil && !errors.Is(err, ErrSpillQuota) {
				t.Errorf("write: %v", err)
			}
		}(index)
	}
	close(start)
	writers.Wait()
	directory, err := stores[0].sessionDirectory(owner, false)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	var total int64
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			t.Fatal(err)
		}
		total += info.Size()
	}
	if total != 256 {
		t.Fatalf("retained=%d, want shared quota 256", total)
	}
}
