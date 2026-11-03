// Diagnostic seam for the authored synthetic PDF only. Never changes persisted
// values, forces a flush, delays shutdown or logs other storage keys/documents.
export const pdfPersistenceTracePrefix = 'Synthetic PDF persistence trace ';
export function installPdfPersistenceTrace(options, locatorOptions) {
  const { key, phase } = locatorOptions ?? options;
  if (location.protocol !== 'pero-app:' || location.hostname !== 'paper-agent') return;
  if (!/^pero\.paper\.pdf-view:[a-f0-9]{64}:[a-f0-9]{64}$/.test(key)) throw Error('Invalid synthetic PDF state key');
  window.paperPdfPersistenceTrace?.restore();
  const native = Storage.prototype.setItem;
  let count = 0, snapshots = 0, capturedClear = false, armed = false;
  const fingerprint = value => {
    try { return JSON.stringify(JSON.parse(value)?.selection ?? null); }
    catch { return 'invalid'; }
  };
  let previous = fingerprint(localStorage.getItem(key));
  const emit = (event, value, stack = '', reserved = false) => {
    if (!reserved && count++ >= 128) return;
    console.info('Synthetic PDF persistence trace ' + JSON.stringify({ phase, event, key, value, stack }));
  };
  window.paperPdfPersistenceTrace = {
    key,
    restore: () => { Storage.prototype.setItem = native; },
    snapshot: event => {
      if (snapshots++ >= 8) return;
      // The pointer-down clear is expected. Reserve evidence only after the
      // completed new drag has a nonempty range at the mouseup checkpoint.
      const selected = fingerprint(localStorage.getItem(key));
      if (event === 'after-mouseup' && !armed && selected !== 'null' && selected !== 'invalid') {
        armed = true; capturedClear = false;
      }
      console.info('Synthetic PDF persistence trace ' + JSON.stringify({ phase, event, key, value: localStorage.getItem(key) }));
    },
  };
  emit('initial', localStorage.getItem(key));
  Storage.prototype.setItem = function (name, value) {
    const result = native.call(this, name, value);
    if (this === localStorage && name === key) {
      const current = localStorage.getItem(key), next = fingerprint(current);
      if (next !== previous) {
        // Rebinding subscriptions can write the same range hundreds of times.
        // Spend the bounded log on range changes, and reserve the first post-mouseup clear
        // even if an unexpectedly long drag exhausts the ordinary budget.
        const firstClear = armed && !capturedClear && previous !== 'null' && previous !== 'invalid' && next === 'null';
        if (firstClear) capturedClear = true;
        previous = next;
        emit('setItem', current, new Error().stack, firstClear);
      }
    }
    return result;
  };
}

export function snapshotPdfPersistenceTrace(_element, { key, event }) {
  if (window.paperPdfPersistenceTrace?.key !== key) throw Error('Synthetic PDF trace owner mismatch');
  window.paperPdfPersistenceTrace.snapshot(event);
}
