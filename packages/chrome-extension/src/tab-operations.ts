import type { DriverOperation } from '../../../desktop/src/main/browser-use/native-use.ts';
import { MAX_TRANSFER_BYTES, webOrigin } from './protocol.ts';

export type Cdp = (method: string, params?: Record<string, unknown>) => Promise<any>;

export async function checkFrames(tabId: number, origin: string) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  if (!frames?.length || frames.some(frame => frame.errorOccurred || webOrigin(frame.url) !== origin))
    throw new Error('A Chrome screenshot requires all frames to have the approved origin.');
  return frames.map(frame => frame.documentId).sort().join(',');
}

export async function screenshot(cdp: Cdp, clip: Extract<DriverOperation, { kind: 'screenshot' }>['clip']) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  if (typeof data !== 'string' || data.length > Math.ceil(MAX_TRANSFER_BYTES / 3) * 4)
    throw new Error('The Chrome viewport screenshot exceeds 10 MiB.');
  const bytes = Uint8Array.from(atob(data.slice(0, 32)), character => character.charCodeAt(0));
  const header = new DataView(bytes.buffer);
  const width = header.getUint32(16), height = header.getUint32(20);
  if (!clip) return { base64: data, width, height };
  if (clip.x + clip.width > width || clip.y + clip.height > height)
    throw new Error('The screenshot clip is outside the Chrome viewport.');
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(data), char => char.charCodeAt(0))], { type: 'image/png' }));
  try {
    const canvas = new OffscreenCanvas(clip.width, clip.height);
    canvas.getContext('2d')!.drawImage(bitmap, clip.x, clip.y, clip.width, clip.height, 0, 0, clip.width, clip.height);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    return { base64: encodeBytes(bytes), width: clip.width, height: clip.height };
  } finally {
    bitmap.close();
  }
}

function encodeBytes(bytes: Uint8Array) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}

async function readLink(url: string, limit: number, encode: typeof encodeBytes) {
  const response = await fetch(url, {
    credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(12000),
  });
  if (!response.ok || !response.body) throw new Error(`The download returned HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > limit) throw new Error('The Chrome download exceeds 10 MiB.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('The Chrome download exceeds 10 MiB.');
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { base64: encode(bytes), disposition: response.headers.get('content-disposition') ?? '' };
}

export async function downloadLink(cdp: Cdp, world: string, origin: string, url: string) {
  const parsed = URL.canParse(url) ? new URL(url) : undefined;
  if (!parsed || (parsed.protocol === 'blob:' ? parsed.origin : webOrigin(url)) !== origin)
    throw new Error('The download link is outside the approved Chrome origin.');
  return evaluateDocument(cdp, world, origin,
    `(${readLink.toString()})(${JSON.stringify(url)}, ${MAX_TRANSFER_BYTES}, (${encodeBytes.toString()}))`, true);
}

export async function evaluateDocument(cdp: Cdp, world: string, origin: string, expression: string, awaitPromise = false) {
  const { frameTree } = await cdp('Page.getFrameTree');
  const frame = frameTree?.frame;
  if (!frame || webOrigin(frame.url) !== origin) throw new Error('The Chrome tab left its authorization.');
  const { executionContextId } = await cdp('Page.createIsolatedWorld', { frameId: frame.id, worldName: world });
  const result = await cdp('Runtime.evaluate', {
    expression, contextId: executionContextId, returnByValue: true, silent: true, awaitPromise,
  });
  if (result.exceptionDetails || !result.result || result.result.value === undefined)
    throw new Error(awaitPromise ? 'Could not read the approved download link (redirects and oversized files are refused).' :
      'The authorized Chrome document did not answer.');
  return result.result.value;
}

export async function navigate(
  cdp: Cdp, tabId: number, origin: string, operation: Extract<DriverOperation, { kind: 'navigate' | 'history' }>,
  newlyOpened = false,
) {
  const { frameTree } = await cdp('Page.getFrameTree');
  const frame = frameTree?.frame;
  if (!frame || (webOrigin(frame.url) !== origin && !(newlyOpened && frame.url === 'about:blank')))
    return { rejected: 'The Chrome tab left its authorization.' };
  let command: () => Promise<unknown>;
  if (operation.kind === 'navigate') {
    if (webOrigin(operation.url) !== origin) return { rejected: 'The destination is outside the approved Chrome origin.' };
    command = async () => {
      const result = await cdp('Page.navigate', { url: operation.url });
      if (result.errorText || result.isDownload) throw new Error('Chrome could not navigate to the approved page.');
    };
  } else if (operation.action === 'reload') {
    command = () => cdp('Page.reload', { loaderId: frame.loaderId });
  } else {
    const { currentIndex, entries } = await cdp('Page.getNavigationHistory');
    const destination = entries[currentIndex + (operation.action === 'back' ? -1 : 1)];
    if (!destination) return { rejected: 'There is no Chrome history entry in that direction.' };
    if (webOrigin(destination.url) !== origin) return { rejected: 'The history destination is outside the approved Chrome origin.' };
    command = () => cdp('Page.navigateToHistoryEntry', { entryId: destination.id });
  }

  // CDP checks request-stage redirects before Chrome sends them. Only gate
  // the main frame of the operation; sites can still load their subframes.
  let complete!: () => void, fail!: (error: Error) => void;
  const completed = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
  const onLoaded = (event: { tabId: number; frameId: number }) => {
    if (event.tabId === tabId && event.frameId === 0) complete();
  };
  const onError = (event: { tabId: number; frameId: number }) => {
    if (event.tabId === tabId && event.frameId === 0) fail(new Error('Chrome navigation did not complete.'));
  };
  const onPause = (source: { tabId?: number }, method: string, value?: {
    requestId: string; frameId: string; request: { url: string };
  }) => {
    if (source.tabId !== tabId || method !== 'Fetch.requestPaused' || !value) return;
    const { requestId } = value;
    if (value.frameId === frame.id && webOrigin(value.request.url) !== origin) {
      void cdp('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
        .then(() => fail(new Error('Chrome navigation redirected outside the approved origin.')), fail);
    } else void cdp('Fetch.continueRequest', { requestId }).catch(fail);
  };
  await cdp('Fetch.enable', { patterns: [{ resourceType: 'Document', requestStage: 'Request' }] });
  chrome.debugger.onEvent.addListener(onPause);
  chrome.webNavigation.onCompleted.addListener(onLoaded);
  chrome.webNavigation.onHistoryStateUpdated.addListener(onLoaded);
  chrome.webNavigation.onReferenceFragmentUpdated.addListener(onLoaded);
  chrome.webNavigation.onErrorOccurred.addListener(onError);
  const timer = setTimeout(() => fail(new Error('Timed out waiting for Chrome navigation.')), 12000);
  try {
    await Promise.all([command(), completed]);
    return null;
  } finally {
    clearTimeout(timer);
    chrome.debugger.onEvent.removeListener(onPause);
    chrome.webNavigation.onCompleted.removeListener(onLoaded);
    chrome.webNavigation.onHistoryStateUpdated.removeListener(onLoaded);
    chrome.webNavigation.onReferenceFragmentUpdated.removeListener(onLoaded);
    chrome.webNavigation.onErrorOccurred.removeListener(onError);
    await cdp('Fetch.disable').catch(() => {});
  }
}
