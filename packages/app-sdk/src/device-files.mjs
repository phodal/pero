export const MAX_DEVICE_BYTES = 32 * 1024 * 1024;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function badPath(value) {
  return typeof value === 'string' && (value.includes('..') || value.includes('/') || value.includes('\\'));
}

/**
 * Interpret one user gesture from a Browser or Desktop provider.
 * The result is an opaque handle. A path is refused.
 */
export function interpretDevicePick(provider, gesture) {
  if (provider !== 'browser' && provider !== 'desktop') throw fail('foreign');
  if (!gesture || gesture.outcome === 'offline' || gesture.offline) return { outcome: 'offline' };
  if (gesture.outcome === 'denied') return { outcome: 'denied' };
  if (gesture.outcome === 'cancelled') return { outcome: 'cancelled' };
  if (badPath(gesture.path) || badPath(gesture.absolutePath) || badPath(gesture.handle?.id) || badPath(gesture.handle?.name)) throw fail('traversal');
  const handle = gesture.handle;
  if (!handle || !handle.id || !handle.name || handle.mediaType !== 'application/pdf') throw fail('foreign');
  if (handle.size > MAX_DEVICE_BYTES) throw fail('over_limit');
  return { outcome: 'selected', handle: { id: handle.id, provider, mediaType: handle.mediaType, size: handle.size, name: handle.name } };
}

export function planDeviceTransfer(handle, target) {
  if (!handle || !target || badPath(target.project) || badPath(target.app) || badPath(handle.id)) throw fail('traversal');
  if (target.app !== 'paper-agent') throw fail('wrong_app');
  return { uploadId: target.uploadId, project: target.project, app: target.app, handleId: handle.id, digest: target.digest, size: handle.size, mediaType: handle.mediaType };
}

export function createBrowserFileProvider(online = () => true) {
  return { pick: gesture => online() ? interpretDevicePick('browser', gesture) : { outcome: 'offline' } };
}

export function createDesktopFileProvider() {
  return { pick: gesture => interpretDevicePick('desktop', gesture) };
}
