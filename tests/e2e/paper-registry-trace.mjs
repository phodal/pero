// Synthetic diagnostic only. This installs React renderer instrumentation, but
// reads Fiber/store state without modifying either or changing callback results.
export const pdfRegistryTracePrefix = 'Synthetic PDF registry trace ';
export function installPdfRegistryTrace() {
  if (location.protocol !== 'pero-app:' || location.hostname !== 'paper-agent') return;
  const previousHook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const hook = previousHook ?? { supportsFiber: true };
  const originals = { inject: hook.inject, onCommitFiberRoot: hook.onCommitFiberRoot };
  const roots = new Set(), subscriptions = new Map(), ids = new WeakMap(), signatures = new Map();
  let nextId = 1, rendererId = 1, options, count = 0, disposed = false;
  let armed = false, reservedReset = false;
  const id = value => {
    if (!value || !['object', 'function'].includes(typeof value)) return null;
    if (!ids.has(value)) ids.set(value, nextId++);
    return ids.get(value);
  };
  const emit = (value, reserve = false) => {
    if (!options || disposed) return;
    if (reserve) {
      if (reservedReset) return;
      reservedReset = true;
    } else if (count++ >= 96) return;
    console.info('Synthetic PDF registry trace ' + JSON.stringify({ documentId: options.documentId, ...value }));
  };
  const inspect = (registry, action = null) => {
    if (!options || disposed) return;
    const state = registry.getStore().getState();
    const selection = state.plugins?.selection?.documents?.[options.documentId];
    const core = state.core?.documents?.[options.documentId];
    const signature = JSON.stringify([!!selection, selection?.selection ?? null, core?.status ?? null]);
    const registryId = id(registry);
    if (signatures.get(registryId) === signature) return;
    // Ignore registries which have never owned the exact synthetic document.
    if (!selection && !core && !signatures.has(registryId)) return;
    const previous = signatures.has(registryId) ? JSON.parse(signatures.get(registryId)) : null;
    const reset = armed && !reservedReset && previous && (
      (previous[1] !== null && selection?.selection == null) ||
      (['START_LOADING_DOCUMENT', 'CLOSE_DOCUMENT'].includes(action?.type))
    );
    signatures.set(registryId, signature);
    emit({ event: 'store', registryId, selectionPresent: !!selection,
      selection: selection?.selection ?? null, status: core?.status ?? null,
      action: typeof action?.type === 'string' ? action.type : null,
      stack: action ? new Error().stack : '', ...(reset ? { reservedPostSelectionReset: true } : {}) }, reset);
  };
  const scan = root => {
    if (!options || disposed) return;
    const pending = [root.current];
    let visited = 0;
    while (pending.length && visited++ < 5000) {
      const fiber = pending.pop(); if (!fiber) continue;
      if (fiber.child) pending.push(fiber.child);
      if (fiber.sibling) pending.push(fiber.sibling);
      const props = fiber.memoizedProps;
      if (props?.paper?.id === options.paperId && Object.hasOwn(props, 'lockText') && Object.hasOwn(props, 'focus')) {
        if (fiber.alternate && ids.has(fiber.alternate) && !ids.has(fiber)) ids.set(fiber, ids.get(fiber.alternate));
        const ownerId = id(fiber);
        if (fiber.alternate) ids.set(fiber.alternate, ownerId);
        // PdfReader's first hooks are reading, load epoch and lookup attempt.
        // Report only identity/category/numbers, never document text or URLs.
        const readingId = fiber.memoizedState?.memoizedState?.document?.id;
        const epoch = fiber.memoizedState?.next?.memoizedState?.current;
        const attempt = fiber.memoizedState?.next?.next?.memoizedState;
        const value = { event: 'reader-inputs', ownerId, apiId: id(props.api), paperId: options.paperId,
          reading: !readingId ? 'none' : readingId === options.documentId ? 'fixture' : 'other',
          loadEpoch: Number.isSafeInteger(epoch) ? epoch : null,
          lookupAttempt: Number.isSafeInteger(attempt) ? attempt : null,
          focus: !props.focus ? 'none' : props.focus.documentId === options.documentId ? 'fixture' : 'other',
          lockText: !!props.lockText, pdfReloadToken: props.pdfReloadToken ?? null, readRequest: props.readRequest ?? null };
        const signature = JSON.stringify(value), key = 'reader-inputs';
        if (signatures.get(key) !== signature) { signatures.set(key, signature); emit(value); }
      }
      if (!props?.engine || !Array.isArray(props.plugins)) continue;
      for (let slot = fiber.memoizedState, n = 0; slot && n++ < 32; slot = slot.next) {
        const registry = slot.memoizedState;
        if (!registry || typeof registry.getStore !== 'function' || typeof registry.getPlugin !== 'function') continue;
        const state = registry.getStore().getState();
        if (!state.core?.documents?.[options.documentId] && !state.plugins?.selection?.documents?.[options.documentId]) continue;
        if (!subscriptions.has(registry)) {
          if (subscriptions.size >= 16) continue;
          emit({ event: 'registry', registryId: id(registry), engineId: id(props.engine), pluginsId: id(props.plugins) });
          inspect(registry);
          subscriptions.set(registry, registry.getStore().subscribe(action => {
            try { inspect(registry, action); } catch { emit({ event: 'diagnostic-error', operation: 'store-read' }); }
          }));
        }
      }
    }
  };
  const wrappedInject = function (...args) {
    return originals.inject ? Reflect.apply(originals.inject, this, args) : rendererId++;
  };
  const wrappedCommit = function (...args) {
    const result = originals.onCommitFiberRoot ? Reflect.apply(originals.onCommitFiberRoot, this, args) : undefined;
    if (!disposed) {
      const root = args[1]; if (roots.size < 4) roots.add(root);
      try { scan(root); } catch { emit({ event: 'diagnostic-error', operation: 'fiber-read' }); }
    }
    return result;
  };
  hook.inject = wrappedInject; hook.onCommitFiberRoot = wrappedCommit;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  const stop = () => {
    if (disposed) return;
    for (const unsubscribe of subscriptions.values()) unsubscribe();
    subscriptions.clear(); roots.clear(); disposed = true;
    if (hook.inject === wrappedInject) hook.inject = originals.inject;
    if (hook.onCommitFiberRoot === wrappedCommit) hook.onCommitFiberRoot = originals.onCommitFiberRoot;
    if (!previousHook && window.__REACT_DEVTOOLS_GLOBAL_HOOK__ === hook) delete window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    window.removeEventListener('pagehide', stop);
  };
  window.paperPdfRegistryTrace = {
    configure(value) {
      if (disposed || !/^[a-f0-9]{64}$/.test(value?.documentId) || !/^[a-f0-9]{64}$/.test(value?.fileDigest) || typeof value?.paperId !== 'string') throw Error('Invalid synthetic registry trace scope');
      options = value;
      emit({ event: 'configured', existingRoots: roots.size });
      for (const root of roots) scan(root);
    },
    armAfterSelection() {
      // Called only after the final synthetic mouseup. Earlier expected pointer-down
      // clears cannot consume the one reset record reserved beyond the ordinary cap.
      armed = [...subscriptions.keys()].some(registry =>
        registry.getStore().getState().plugins?.selection?.documents?.[options?.documentId]?.selection != null);
      emit({ event: 'after-mouseup-arm', armed });
      return armed;
    },
    stop,
  };
  window.addEventListener('pagehide', stop);
}
export function configurePdfRegistryTrace(_element, options) {
  if (!window.paperPdfRegistryTrace) throw Error('Synthetic PDF registry instrumentation was not installed before React');
  window.paperPdfRegistryTrace.configure(options);
}

export function armPdfRegistryTraceAfterSelection() {
  window.paperPdfRegistryTrace?.armAfterSelection();
}
