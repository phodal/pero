import { capabilityOutcome, createCapabilitySnapshot } from '../../packages/app-sdk/src/capability-client.mjs';
import { interpretDevicePick, planDeviceTransfer } from '../../packages/app-sdk/src/device-files.mjs';
import { readPaperResource } from '../../packages/app-sdk/src/resource-read.mjs';
import { observeRun } from '../../packages/app-sdk/src/run-lifecycle.mjs';

const textEncoder = new TextEncoder();

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(part => part.toString(16).padStart(2, '0')).join('');
}

function paperResource(corpus, id, revision) {
  return {
    ownerHost: corpus.ownerHost,
    sharedProject: corpus.project,
    localProject: corpus.localProject,
    app: corpus.app,
    appInstance: corpus.appInstance,
    appVersion: corpus.appVersion,
    kind: 'paper',
    id,
    revision,
    class: 'immutable',
  };
}

/**
 * One browser session against the protocol harness.
 * The token is a project client. This function does not send an operator credential
 * and it does not call a route outside the selected set.
 */
export async function runProtocolSlice({ origin, corpus, pdfBytes, fetchImpl = globalThis.fetch }) {
  const snapshot = createCapabilitySnapshot({
    providerGeneration: 'browser-1',
    operations: { 'paper/read': { version: 1 }, 'run/observe': { version: 1 }, 'device/pick': { version: 1 } },
  });
  for (const [capability, operation] of [['paper', 'read'], ['run', 'observe'], ['device', 'pick']]) {
    if (capabilityOutcome(snapshot, capability, operation) !== 'ready') {
      throw Object.assign(new Error('incompatible'), { code: 'incompatible' });
    }
  }
  const headers = { Authorization: `Bearer ${corpus.clientToken}` };
  const meResponse = await fetchImpl(`${origin}/api/client/v1/me`, { headers });
  const me = await meResponse.json();
  if (!meResponse.ok || me.role !== 'client' || !me.projects?.includes(corpus.project) || me.token || me.operatorToken) {
    throw Object.assign(new Error('revoked'), { code: 'revoked' });
  }
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
  const papers = {
    async read(request) {
      const response = await fetchImpl(`${origin}/api/client/v1/projects/${corpus.project}/app-resources/paper`, {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify(request.resource),
      });
      const payload = await response.json();
      if (!response.ok) throw Object.assign(new Error(payload.error || 'owner_unavailable'), { code: payload.error || 'owner_unavailable' });
      return payload;
    },
  };
  let opened;
  try {
    opened = await readPaperResource(papers, { resource: paperResource(corpus, corpus.paperId, corpus.revision) });
  } catch (error) {
    if (!error || error.code !== 'missing') throw error;
  }
  const pdf = pdfBytes ?? textEncoder.encode(corpus.pdf);
  const digest = await sha256(pdf);
  const stamp = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const handleId = `handle-${stamp}`;
  const uploadId = `upload-${stamp}`;
  const requestId = `req-${stamp}`;
  const pick = interpretDevicePick('browser', {
    outcome: 'selected',
    handle: { id: handleId, name: 'note.pdf', mediaType: 'application/pdf', size: pdf.byteLength },
  });
  const plan = planDeviceTransfer(pick.handle, {
    project: corpus.project, app: 'paper-agent', uploadId, digest,
  });
  if (plan.path || pick.handle.path) throw Object.assign(new Error('traversal'), { code: 'traversal' });
  const registered = await fetchImpl(`${origin}/api/client/v1/projects/${corpus.project}/device-handles`, {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ id: pick.handle.id, provider: 'browser', mediaType: pick.handle.mediaType, size: pick.handle.size, name: pick.handle.name }),
  });
  if (!registered.ok) throw Object.assign(new Error('foreign'), { code: 'foreign' });
  const uploaded = await fetchImpl(`${origin}/api/client/v1/projects/${corpus.project}/device-transfers/${plan.uploadId}`, {
    method: 'POST',
    headers: { Authorization: headers.Authorization, 'X-Pero-Handle': pick.handle.id, 'Content-Type': 'application/pdf' },
    body: pdf,
  });
  if (uploaded.status !== 202) throw Object.assign(new Error('interrupted'), { code: 'interrupted' });
  async function finalize() {
    const response = await fetchImpl(`${origin}/api/client/v1/projects/${corpus.project}/device-transfers/${plan.uploadId}/finalize`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ app: 'paper-agent', digest, mediaType: 'application/pdf', size: pdf.byteLength, handle: pick.handle.id }),
    });
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload.error || 'unavailable'), { code: payload.error || 'unavailable' });
    return payload;
  }
  const first = await finalize();
  const second = await finalize();
  const imported = await readPaperResource(papers, { resource: paperResource(corpus, first.paperId, first.revision) });
  const reopened = await readPaperResource(papers, { resource: paperResource(corpus, first.paperId, first.revision) });
  const observeStatus = new Map();
  const runs = {
    async observe(call) {
      const response = await fetchImpl(`${origin}/api/client/v1/projects/${corpus.project}/runs/observe`, {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify({ binding: call.binding, request: call.request }),
      });
      const payload = await response.json();
      observeStatus.set(call.request.requestId, response.status);
      if (!response.ok) throw Object.assign(new Error(payload.outcome || payload.error || 'unknown'), { code: payload.outcome || payload.error || 'unknown' });
      return payload;
    },
  };
  const binding = {
    kind: 'control_plane_run', ownerHost: corpus.runOwner, project: corpus.project,
    id: corpus.runId, generation: 1, scope: corpus.project,
  };
  const observed = await observeRun(runs, {
    binding, request: { operation: 'status', requestId, inputHash: 'same', generation: 1 },
  });
  const disconnected = await observeRun(runs, {
    binding, knownStatus: observed.status,
    request: { operation: 'status', requestId: `disconnect-${stamp}`, inputHash: 'same', generation: 1, consumerClosed: true },
  });
  const replay = await observeRun(runs, {
    binding, request: { operation: 'status', requestId, inputHash: 'same', generation: 1 },
  });
  return {
    me, opened, first, second, imported, reopened, observed, disconnected, replay, digest,
    disconnectStatus: observeStatus.get(`disconnect-${stamp}`),
  };
}
