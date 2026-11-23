export const BROWSER_DOWNLOAD_LIMIT = 10 * 1024 * 1024;

export function encodeBytes(bytes: Uint8Array) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}

async function readLink(origin: string, url: string, limit: number, encode: typeof encodeBytes) {
  if (location.origin !== origin) throw new Error('The browser tab left the approved origin.');
  const response = await fetch(url, {
    credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(12000),
  });
  if (!response.ok || !response.body) throw new Error(`The download returned HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > limit) throw new Error('The browser download exceeds 10 MiB.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('The browser download exceeds 10 MiB.');
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

/** Read one observed link in the authorized document's isolated world. */
export function downloadLinkScript(origin: string, address: string) {
  const url = URL.canParse(address) ? new URL(address) : undefined;
  if (!url || !['http:', 'https:', 'blob:'].includes(url.protocol) || url.origin !== origin || url.username || url.password)
    throw new Error('The download link is outside the approved browser origin.');
  return `(${readLink.toString()})(${JSON.stringify(origin)}, ${JSON.stringify(url.href)}, ${BROWSER_DOWNLOAD_LIMIT}, (${encodeBytes.toString()}))`;
}
