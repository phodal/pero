import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { browserRequest } from './request.ts';

const MAX_REQUEST = 17 << 10;
const MAX_TEXT_REPLY = 256 << 10;
const MAX_IMAGE_BYTES = 2 << 20;
const MAX_IMAGE_REPLY = 3 << 20;
const MAX_IMAGE_EDGE = 2048;
type BrowserCall = (input: unknown, signal: AbortSignal) => Promise<object>;

export function cloudBrowserRequest(value: unknown, tabId: string, screenshots: boolean) {
  const request = browserRequest.parse(value);
  const viewport = request.action === 'screenshot' && screenshots && !request.fullPage;
  if ((!viewport && !['status', 'observe', 'locate', 'click', 'fill'].includes(request.action)) ||
      'tabId' in request || 'frame' in request || 'within' in request || 'expectPopup' in request)
    throw new Error('This Cloud Run can observe and operate only the shared tab.');
  if (viewport && request.clip && Math.max(request.clip.width, request.clip.height) > MAX_IMAGE_EDGE)
    throw new Error('Choose a viewport clip at most 2048 pixels on each edge.');
  return { ...request, tabId };
}

function screenshotReply(result: object) {
  if (!('png' in result) || !Buffer.isBuffer(result.png) || !('receipt' in result))
    throw new Error('Browser Use did not return a PNG with its receipt.');
  const { png, receipt } = result;
  if (!receipt || typeof receipt !== 'object' || !('width' in receipt) || !('height' in receipt) ||
      typeof receipt.width !== 'number' || typeof receipt.height !== 'number' ||
      Math.max(receipt.width, receipt.height) > MAX_IMAGE_EDGE || png.length > MAX_IMAGE_BYTES)
    throw new Error('Choose a viewport clip at most 2048 pixels on each edge and 2 MiB as PNG.');
  return { kind: 'screenshot', receipt, png: png.toString('base64') };
}

export function connectCloudBrowser(base: string, token: string, runId: string, sessionId: string,
  signal: AbortSignal, grant: () => AbortSignal, call: BrowserCall): Promise<{ closed: Promise<void> }> {
  const endpoint = new URL(`/api/runtime/v1/runs/${runId}/browser/desktop`, base);
  endpoint.searchParams.set('session_id', sessionId);
  const send = endpoint.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = send(endpoint, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-ndjson' },
    }, response => {
      clearTimeout(timeout);
      if (response.statusCode !== 200 || response.headers['content-type'] !== 'application/x-ndjson') {
        request.destroy();
        reject(new Error(`The Cloud Run refused the browser connection (HTTP ${response.statusCode ?? 'unknown'}).`));
        return;
      }
      let active: AbortSignal;
      try { active = grant(); }
      catch (error) { request.destroy(); reject(error); return; }
      const channel = new AbortController();
      response.once('close', () => channel.abort());
      const lifetime = AbortSignal.any([signal, active, channel.signal]);
      const close = () => request.destroy();
      lifetime.addEventListener('abort', close, { once: true });
      if (lifetime.aborted) close();
      const closed = consume(response, lifetime, call, line => request.write(line))
        .catch(() => { /* The Workbench revokes this grant when the stream stops. */ })
        .finally(() => {
          lifetime.removeEventListener('abort', close);
          channel.abort();
          close();
        });
      resolve({ closed });
    });
    const timeout = setTimeout(() => request.destroy(new Error('The Cloud Run did not accept the browser connection.')), 8_000);
    request.on('error', error => { clearTimeout(timeout); reject(error); });
    request.flushHeaders();
  });
}

async function consume(response: IncomingMessage, signal: AbortSignal, call: BrowserCall, reply: (line: string) => void) {
  let remaining = '';
  let expected = 1;
  response.setEncoding('utf8');
  for await (const chunk of response) {
    remaining += chunk;
    if (Buffer.byteLength(remaining) > MAX_REQUEST) throw new Error('Browser request exceeds its frame limit.');
    let newline: number;
    while ((newline = remaining.indexOf('\n')) !== -1) {
      signal.throwIfAborted();
      const frame: unknown = JSON.parse(remaining.slice(0, newline));
      remaining = remaining.slice(newline + 1);
      if (!frame || typeof frame !== 'object' || !('id' in frame) || frame.id !== expected ||
          !('value' in frame) || !frame.value || typeof frame.value !== 'object' || Array.isArray(frame.value))
        throw new Error('The Cloud browser call is invalid.');
      let result: object;
      try {
        result = await call(frame.value, signal);
        if ('kind' in result && result.kind === 'screenshot') result = screenshotReply(result);
      }
      catch (error) { result = { kind: 'error', message: (error instanceof Error ? error.message : 'Browser Use failed.').slice(0, 500) }; }
      signal.throwIfAborted();
      let line = JSON.stringify({ id: expected, value: result }) + '\n';
      const limit = 'kind' in result && result.kind === 'screenshot' ? MAX_IMAGE_REPLY : MAX_TEXT_REPLY;
      if (Buffer.byteLength(line) > limit)
        line = JSON.stringify({ id: expected, value: { kind: 'error', message: 'Browser result exceeds the Cloud reply limit.' } }) + '\n';
      reply(line);
      expected++;
    }
  }
}
