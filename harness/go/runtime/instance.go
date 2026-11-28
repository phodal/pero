package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
)

type State uint8

const (
	Pending State = iota
	Starting
	Active
	Stopping
	Failed
	Disposed
)

func (s State) String() string {
	switch s {
	case Pending:
		return "pending"
	case Starting:
		return "starting"
	case Active:
		return "active"
	case Stopping:
		return "stopping"
	case Failed:
		return "failed"
	case Disposed:
		return "disposed"
	default:
		return "unknown"
	}
}

type ServiceAddressSnapshot struct {
	Key   string
	Realm RealmID
}

type ProviderSnapshot struct {
	Key          string
	InstanceID   uint64
	ActivationID uint64
	LeaseID      uint64
	Generation   uint64
}

type InstanceSnapshot struct {
	ID                uint64
	EntryID           string
	DefinitionID      string
	State             State
	Stable            bool
	DesiredRevision   uint64
	CurrentRevision   uint64
	Missing           []ServiceAddressSnapshot
	Providers         []ProviderSnapshot
	Effects           []EffectMeta
	LastError         string
	CleanupPending    bool
	CleanupIncomplete bool
	dependencyEpoch   uint64
}

type desiredEpoch struct {
	configRevision uint64
	ready          bool
	providers      []providerRevision
	dependencies   map[uint64]resolvedService
	missing        []ServiceAddressSnapshot
}

func (e desiredEpoch) equal(other desiredEpoch) bool {
	if e.configRevision != other.configRevision || e.ready != other.ready || len(e.providers) != len(other.providers) {
		return false
	}
	for index := range e.providers {
		if e.providers[index] != other.providers[index] {
			return false
		}
	}
	return true
}

type activation struct {
	mu sync.Mutex

	id           uint64
	instance     *Instance
	config       any
	epoch        desiredEpoch
	dependencies map[uint64]resolvedService
	staged       map[serviceAddress]*leaseRecord
	closed       bool
	published    atomic.Bool
	run          *Run
	cancel       context.CancelFunc
}

type instanceCommandKind uint8

const (
	commandUpdate instanceCommandKind = iota
	commandRestart
	commandDispose
)

type instanceCommand struct {
	kind   instanceCommandKind
	config any
	ack    chan error
}

type operationResult struct {
	activation *activation
	err        error
}

type activationFailure struct {
	activation *activation
	label      string
	err        error
}

type Instance struct {
	runtime    *Runtime
	id         uint64
	entryID    string
	definition Definition
	scope      *Scope

	commands chan instanceCommand
	wake     chan struct{}
	opDone   chan operationResult
	failures chan activationFailure

	state                   State
	config                  any
	configRevision          uint64
	current                 *activation
	desired                 desiredEpoch
	disposeRequested        bool
	pendingFailure          error
	lastError               error
	disposeError            error
	cleanupIncomplete       bool
	dependencyEpoch         atomic.Uint64
	resolvedDependencyEpoch uint64

	// stopError is the completed receipt owed to the CancelWork owner.
	// Explicit retry commands discard it with the failed generation.
	stopError error

	snapshotMu  sync.RWMutex
	snapshot    InstanceSnapshot
	snapshotErr error
	changeMu    sync.Mutex
	changed     chan struct{}
	done        chan struct{}
}

func newInstance(runtime *Runtime, scope *Scope, entryID string, definition Definition, config any) *Instance {
	return &Instance{
		runtime: runtime, entryID: entryID, definition: definition, scope: scope,
		commands: make(chan instanceCommand), wake: make(chan struct{}, 1), opDone: make(chan operationResult, 1),
		failures: make(chan activationFailure),
		state:    Pending, config: config, configRevision: 1,
		changed: make(chan struct{}), done: make(chan struct{}),
	}
}

func (i *Instance) ID() uint64      { return i.id }
func (i *Instance) EntryID() string { return i.entryID }
func (i *Instance) Scope() *Scope   { return i.scope }
func (i *Instance) State() State    { return i.Snapshot().State }

func (i *Instance) requires(keyID uint64) bool {
	for _, requirement := range i.definition.descriptor.Requires {
		if requirement.Key.id == keyID {
			return true
		}
	}
	return false
}

func (i *Instance) provides(keyID uint64) bool {
	for _, key := range i.definition.descriptor.Provides {
		if key.id == keyID {
			return true
		}
	}
	return false
}

func (i *Instance) startActor() {
	i.resolveDesired()
	i.refreshSnapshot()
	go i.actor()
}

func (i *Instance) actor() {
	defer close(i.done)
	shutdown := i.runtime.context.Done()
	for {
		i.reconcile()
		if i.state == Disposed {
			i.runtime.removeInstance(i)
			return
		}
		select {
		case command := <-i.commands:
			i.handleCommand(command)
		case <-shutdown:
			shutdown = nil
			i.disposeRequested = true
			if i.current != nil && i.state == Starting {
				i.current.cancel()
			}
		case <-i.wake:
			i.resolveDesired()
		case result := <-i.opDone:
			i.handleOperationResult(result)
		case failure := <-i.failures:
			i.handleActivationFailure(failure)
		}
	}
}

func (i *Instance) handleCommand(command instanceCommand) {
	var err error
	switch command.kind {
	case commandUpdate:
		if i.state == Disposed || i.disposeRequested {
			err = ErrDisposedInstance
			break
		}
		i.config = command.config
		i.configRevision++
		i.lastError = nil
		i.stopError = nil
		i.pendingFailure = nil
		if i.state == Failed {
			i.state = Pending
		}
		i.resolveDesired()
	case commandRestart:
		if i.state == Disposed || i.disposeRequested {
			err = ErrDisposedInstance
			break
		}
		i.configRevision++
		i.lastError = nil
		i.stopError = nil
		i.pendingFailure = nil
		if i.state == Failed {
			i.state = Pending
		}
		i.resolveDesired()
	case commandDispose:
		i.disposeRequested = true
		if i.current != nil && i.state == Starting {
			i.current.cancel()
		}
	default:
		err = errors.New("runtime: unknown instance command")
	}
	i.refreshSnapshot()
	// Publish the command's new desired state before waking the caller. In
	// particular, Restart followed immediately by WaitStable must not observe
	// the previous generation as already stable and return before teardown.
	command.ack <- err
}

func (i *Instance) reconcile() {
	i.resolveDesired()
	switch i.state {
	case Pending:
		if i.disposeRequested {
			i.finishDisposed(nil)
		} else if i.desired.ready {
			i.beginStart(i.desired)
		}
	case Starting:
		if i.disposeRequested || !i.current.epoch.equal(i.desired) {
			i.current.cancel()
		}
	case Active:
		if i.disposeRequested || !i.current.epoch.equal(i.desired) {
			i.beginStop(nil)
		}
	case Failed:
		if i.disposeRequested {
			i.finishDisposed(i.stopError)
		}
	}
	i.refreshSnapshot()
}

func (i *Instance) beginStart(epoch desiredEpoch) {
	runContext, cancel := context.WithCancel(i.runtime.context)
	activation := &activation{
		id: i.runtime.nextActivationID.Add(1), instance: i, config: i.config, epoch: epoch,
		dependencies: epoch.dependencies, staged: make(map[serviceAddress]*leaseRecord), cancel: cancel,
	}
	run := &Run{Context: runContext, Scope: i.scope, Instance: i, activation: activation, effects: newEffectGroup("run"), beforeCleanup: newEffectGroup("before-cleanup")}
	run.active.Store(true)
	run.readable.Store(true)
	activation.run = run
	i.current = activation
	i.cleanupIncomplete = false
	i.state = Starting
	i.refreshSnapshot()
	go i.executeStart(activation)
}

func (i *Instance) executeStart(activation *activation) {
	dispose, startErr := callDefinitionStart(i.definition.descriptor.ID, i.definition.start, activation.run, activation.config)
	if dispose != nil {
		if _, err := activation.run.effects.add("plugin", dispose); err != nil {
			startErr = errors.Join(startErr, err)
		}
	}
	if startErr != nil {
		activation.run.active.Store(false)
		activation.cancel()
		startErr = errors.Join(startErr, i.stopEffects(activation))
		activation.run.readable.Store(false)
		i.runtime.closeActivation(activation)
	}
	i.opDone <- operationResult{activation: activation, err: startErr}
}

func callDefinitionStart(
	label string,
	start func(*Run, any) (Dispose, error),
	run *Run,
	config any,
) (dispose Dispose, err error) {
	defer recoverError("definition start "+label, &err)
	return start(run, config)
}

func (i *Instance) handleOperationResult(result operationResult) {
	if result.activation != i.current {
		return
	}
	switch i.state {
	case Starting:
		i.resolveDesired()
		if result.err != nil {
			failure := i.pendingFailure
			combined := errors.Join(failure, result.err)
			i.pendingFailure = nil
			i.current = nil
			if i.disposeRequested {
				i.finishDisposed(failure)
			} else if failure == nil && !result.activation.epoch.equal(i.desired) {
				i.state = Pending
			} else {
				i.lastError = combined
				i.state = Failed
			}
			break
		}
		if i.pendingFailure != nil {
			i.beginStop(nil)
			break
		}
		if i.disposeRequested || !result.activation.epoch.equal(i.desired) {
			i.beginStop(nil)
			break
		}
		if err := i.runtime.publish(result.activation); err != nil {
			i.beginStop(err)
			break
		}
		i.state = Active
	case Stopping:
		i.current = nil
		combined := errors.Join(i.pendingFailure, result.err)
		if result.activation.run.workCancelRequested.Load() {
			i.stopError = combined
		}
		i.pendingFailure = nil
		i.cleanupIncomplete = errors.Is(result.err, context.DeadlineExceeded)
		if i.disposeRequested {
			i.finishDisposed(combined)
		} else if combined != nil {
			i.lastError = combined
			i.state = Failed
		} else {
			i.state = Pending
		}
	}
	i.refreshSnapshot()
}

func (i *Instance) beginStop(cause error) {
	activation := i.current
	if activation == nil {
		if cause != nil {
			i.lastError = cause
			i.state = Failed
		}
		return
	}
	if cause != nil {
		i.pendingFailure = errors.Join(i.pendingFailure, cause)
	}
	activation.run.active.Store(false)
	activation.cancel()
	affected := i.runtime.unpublish(activation)
	i.state = Stopping
	i.refreshSnapshot()
	go func() {
		ctx, cancel := i.cleanupContext()
		defer cancel()
		err := activation.run.beforeCleanup.stop(ctx)
		err = errors.Join(err, i.runtime.waitForProviderDrain(ctx, activation, affected))
		err = errors.Join(err, activation.run.effects.stop(ctx))
		activation.run.readable.Store(false)
		i.runtime.closeActivation(activation)
		i.opDone <- operationResult{activation: activation, err: err}
	}()
}

func (i *Instance) stopEffects(activation *activation) error {
	ctx, cancel := i.cleanupContext()
	defer cancel()
	return errors.Join(activation.run.beforeCleanup.stop(ctx), activation.run.effects.stop(ctx))
}

func (i *Instance) cleanupContext() (context.Context, context.CancelFunc) {
	if i.runtime.cleanupTimeout < 0 {
		return context.WithCancel(context.Background())
	}
	return context.WithTimeout(context.Background(), i.runtime.cleanupTimeout)
}

func (i *Instance) reportActivationFailure(failure activationFailure) {
	select {
	case i.failures <- failure:
	case <-i.done:
	}
}

func (i *Instance) handleActivationFailure(failure activationFailure) {
	if failure.activation == nil || failure.activation != i.current || failure.err == nil {
		return
	}
	wrapped := fmt.Errorf("task %q: %w", failure.label, failure.err)
	switch i.state {
	case Starting:
		i.pendingFailure = errors.Join(i.pendingFailure, wrapped)
		i.current.cancel()
	case Active:
		i.beginStop(wrapped)
	case Stopping:
		i.pendingFailure = errors.Join(i.pendingFailure, wrapped)
	}
	i.refreshSnapshot()
}

func (i *Instance) waitForProviderDrain(ctx context.Context, instanceID, activationID uint64) error {
	for {
		i.changeMu.Lock()
		changed := i.changed
		i.changeMu.Unlock()
		snapshot := i.Snapshot()
		usesProvider := false
		for _, provider := range snapshot.Providers {
			if provider.InstanceID == instanceID && provider.ActivationID == activationID {
				usesProvider = true
				break
			}
		}
		if !usesProvider {
			return nil
		}
		select {
		case <-changed:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (i *Instance) finishDisposed(err error) {
	i.disposeError = errors.Join(i.disposeError, err)
	if err != nil {
		i.lastError = err
	}
	i.state = Disposed
	i.refreshSnapshot()
}

func (i *Instance) notifyDependencyChanged() {
	i.dependencyEpoch.Add(1)
	select {
	case i.wake <- struct{}{}:
	default:
	}
}

func (i *Instance) send(ctx context.Context, command instanceCommand) error {
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-i.done:
		if command.kind == commandDispose {
			// Already finished. A canceled caller must not observe success.
			return ctx.Err()
		}
		return ErrDisposedInstance
	case i.commands <- command:
	case <-ctx.Done():
		return ctx.Err()
	}
	select {
	case err := <-command.ack:
		if command.kind == commandDispose {
			return expireCaller(ctx, err)
		}
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

// expireCaller keeps a canceled caller from observing a nil dispose result.
// select may take the finished command while ctx.Done is also ready.
func expireCaller(ctx context.Context, err error) error {
	if ctx.Err() == nil {
		return err
	}
	if err == nil {
		return ctx.Err()
	}
	return errors.Join(ctx.Err(), err)
}

func (i *Instance) Update(ctx context.Context, config []byte) error {
	decoded, err := i.definition.decode(json.RawMessage(config))
	if err != nil {
		return fmt.Errorf("runtime: decode config for %q: %w", i.definition.descriptor.ID, err)
	}
	return i.send(ctx, instanceCommand{kind: commandUpdate, config: decoded, ack: make(chan error, 1)})
}

func (i *Instance) Restart(ctx context.Context) error {
	return i.send(ctx, instanceCommand{kind: commandRestart, ack: make(chan error, 1)})
}

// Dispose asks the actor to shut down and waits for it.
//
// A canceled or expired caller context is returned even when shutdown itself
// succeeded. select can observe both the finished command and ctx.Done, and
// the caller must see that they left. This is not a failed dispose and not a
// signal to start the instance again: Runtime.Dispose cancels the runtime
// before this wait, so shutdown continues after the return.
//
// Callers that surface the error:
//   - Application reconcile (application.go) stops the pass and does not retry.
//   - workflow.App.Dispose / Close returns it from a fresh timeout and does not retry.
//   - ToolContribution.Dispose returns it to the composition root; a canceled
//     caller is cancellation, not a reason to mount the tool again.
func (i *Instance) Dispose(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := i.send(ctx, instanceCommand{kind: commandDispose, ack: make(chan error, 1)}); err != nil {
		return err
	}
	select {
	case <-i.done:
		i.snapshotMu.RLock()
		err := i.disposeError
		i.snapshotMu.RUnlock()
		return expireCaller(ctx, err)
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (i *Instance) WaitStable(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	for {
		i.changeMu.Lock()
		changed := i.changed
		i.changeMu.Unlock()
		snapshot := i.Snapshot()
		if snapshot.Stable && snapshot.dependencyEpoch == i.dependencyEpoch.Load() {
			return nil
		}
		select {
		case <-changed:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (i *Instance) Snapshot() InstanceSnapshot {
	i.snapshotMu.RLock()
	snapshot := i.snapshot
	snapshot.Missing = append([]ServiceAddressSnapshot(nil), snapshot.Missing...)
	snapshot.Providers = append([]ProviderSnapshot(nil), snapshot.Providers...)
	snapshot.Effects = cloneEffectMeta(snapshot.Effects)
	i.snapshotMu.RUnlock()
	return snapshot
}

func (i *Instance) LastError() error {
	i.snapshotMu.RLock()
	err := i.snapshotErr
	i.snapshotMu.RUnlock()
	return err
}

func cloneEffectMeta(source []EffectMeta) []EffectMeta {
	if len(source) == 0 {
		return nil
	}
	result := make([]EffectMeta, len(source))
	for index, meta := range source {
		result[index] = meta
		result[index].Children = cloneEffectMeta(meta.Children)
	}
	return result
}

func (i *Instance) refreshSnapshot() {
	stable := (i.state == Pending && !i.desired.ready) ||
		(i.state == Active && i.current != nil && i.current.epoch.equal(i.desired)) ||
		i.state == Failed || i.state == Disposed
	snapshot := InstanceSnapshot{
		ID: i.id, EntryID: i.entryID, DefinitionID: i.definition.descriptor.ID,
		State: i.state, Stable: stable, DesiredRevision: i.configRevision,
		Missing:           append([]ServiceAddressSnapshot(nil), i.desired.missing...),
		CleanupPending:    i.state == Stopping,
		CleanupIncomplete: i.cleanupIncomplete,
		dependencyEpoch:   i.resolvedDependencyEpoch,
	}
	if i.current != nil {
		if i.state == Active {
			snapshot.CurrentRevision = i.current.epoch.configRevision
		}
		for _, provider := range i.current.epoch.providers {
			if !provider.present {
				continue
			}
			name := ""
			for _, requirement := range i.definition.descriptor.Requires {
				if requirement.Key.id == provider.keyID {
					name = requirement.Key.name
					break
				}
			}
			snapshot.Providers = append(snapshot.Providers, ProviderSnapshot{
				Key: name, InstanceID: provider.instanceID, ActivationID: provider.activationID,
				LeaseID: provider.leaseID, Generation: provider.generation,
			})
		}
		snapshot.Effects = append(i.current.run.beforeCleanup.snapshot(), i.current.run.effects.snapshot()...)
	}
	if i.lastError != nil {
		snapshot.LastError = i.lastError.Error()
	}

	i.snapshotMu.Lock()
	i.snapshot = snapshot
	i.snapshotErr = i.lastError
	i.snapshotMu.Unlock()
	i.changeMu.Lock()
	close(i.changed)
	i.changed = make(chan struct{})
	i.changeMu.Unlock()
}

func (i *Instance) resolveDesired() {
	for {
		epoch := i.dependencyEpoch.Load()
		desired := i.runtime.resolveDependencies(i)
		if i.dependencyEpoch.Load() == epoch {
			i.desired = desired
			i.resolvedDependencyEpoch = epoch
			return
		}
	}
}
