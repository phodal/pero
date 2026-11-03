// Diagnostic seam for the authored synthetic PDF only. Never changes persisted
// values, forces a flush, delays shutdown or logs other storage keys/documents.
export const pdfPersistenceTracePrefix = 'Synthetic PDF persistence trace ';
export function installPdfPersistenceTrace(options, locatorOptions) {
  const { key, phase } = locatorOptions ?? options;
  if (location.protocol !== 'pero-app:' || location.hostname !== 'paper-agent') return;
  if (!/^pero\.paper\.pdf-view:[a-f0-9]{64}:[a-f0-9]{64}$/.test(key)) throw Error('Invalid synthetic PDF state key');
  const native = Storage.prototype.setItem;
  let count = 0;
  const emit = (event, value, stack = '') => {
    if (count++ >= 40) return;
    console.info('Synthetic PDF persistence trace ' + JSON.stringify({ phase, event, key, value, stack }));
  };
  emit('initial', localStorage.getItem(key));
  Storage.prototype.setItem = function (name, value) {
    const result = native.call(this, name, value);
    if (this === localStorage && name === key) emit('setItem', localStorage.getItem(key), new Error().stack);
    return result;
  };
}
