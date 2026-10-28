package harness

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestSubagentProviderWatcherCanUnsubscribeInsideCallback(t *testing.T) {
	h := subagentTestHarness(t)
	r := h.Subagents()
	var count atomic.Int32
	var unsubscribe func()
	unsubscribe = r.WatchProviderDescriptors(h.Runtime().Root(), func([]SubagentProviderDescriptor) {
		if count.Add(1) == 2 {
			unsubscribe()
		}
	})
	done := make(chan struct{})
	go func() { r.notifyProviderWatchers(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("self-unsubscribe waited on its callback")
	}
	r.notifyProviderWatchers()
	if count.Load() != 2 {
		t.Fatalf("callbacks=%d", count.Load())
	}
	unsubscribe()
}

func TestSubagentProviderWatcherCapturedBeforeDisposeIsNotAdmitted(t *testing.T) {
	h := subagentTestHarness(t)
	r := h.Subagents()
	var count atomic.Int32
	unsubscribe := r.WatchProviderDescriptors(h.Runtime().Root(), func([]SubagentProviderDescriptor) { count.Add(1) })
	defer unsubscribe()
	r.mu.RLock()
	var captured *subagentProviderWatcher
	for _, w := range r.watchers {
		captured = w
	}
	r.mu.RUnlock()
	if captured == nil {
		t.Fatal("no captured listener")
	}
	if err := r.Dispose(context.Background()); err != nil && !errors.Is(err, ErrSubagentDisposalInProgress) {
		t.Fatal(err)
	}
	if err := r.Drain(t.Context()); err != nil {
		t.Fatal(err)
	}
	captured.deliver(r)
	if count.Load() != 1 {
		t.Fatalf("retired callback admitted: %d", count.Load())
	}
}

func TestSubagentProviderWatcherReentrantNotificationsAreSerial(t *testing.T) {
	h := subagentTestHarness(t)
	r := h.Subagents()
	var depth, maximum, count int
	unsubscribe := r.WatchProviderDescriptors(h.Runtime().Root(), func([]SubagentProviderDescriptor) {
		depth++
		if depth > maximum {
			maximum = depth
		}
		count++
		if count < 3 {
			r.notifyProviderWatchers()
			r.notifyProviderWatchers()
		}
		depth--
	})
	defer unsubscribe()
	if maximum != 1 || count != 3 {
		t.Fatalf("depth=%d callbacks=%d", maximum, count)
	}
	if r.callbacks.Load() != 0 {
		t.Fatal("callback admission leaked")
	}
}

func TestSubagentProviderWatcherInitialPanicDoesNotLeakSubscription(t *testing.T) {
	h := subagentTestHarness(t)
	r := h.Subagents()
	r.mu.RLock()
	before := len(r.watchers)
	r.mu.RUnlock()
	func() {
		defer func() {
			if recover() != "fixture" {
				t.Fatal("callback panic lost")
			}
		}()
		r.WatchProviderDescriptors(h.Runtime().Root(), func([]SubagentProviderDescriptor) { panic("fixture") })
	}()
	r.mu.RLock()
	after := len(r.watchers)
	r.mu.RUnlock()
	if before != after || r.callbacks.Load() != 0 {
		t.Fatalf("watchers=%d->%d callbacks=%d", before, after, r.callbacks.Load())
	}
}
