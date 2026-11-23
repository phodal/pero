import { request, currentTab } from './sidebar-client.js';
const node = (id) => document.getElementById('collector-' + id);
let capture,
  session,
  pending,
  busy = false;
let destinations = new Map();
const bytesOf = text => new TextEncoder().encode(text).length;
function draft() {
  const destination = destinations.get(node('destination').value);
  return {
    kind: 'collect',
    title: node('title').value.trim(),
    content: node('content').value.trim(),
    reason: node('reason').value.trim(),
    question: node('question').value.trim(),
    projectId: destination?.id,
    sharedProject: destination?.target && {
      origin: destination.target.origin, accountId: destination.target.accountId,
    },
  };
}
function render() {
  const d = draft();
  const preview = [
    '# ' + d.title,
    capture?.url,
    d.projectId && capture &&
      `Chrome ${capture.captureScope} · ${capture.capturedAt} (Unix ms)${capture.truncated ? '\nCapture was truncated.' : ''}`,
    d.content,
    d.reason && '## Why collect it?\n' + d.reason,
    d.question && '## Question\n' + d.question,
  ]
    .filter(Boolean)
    .join('\n\n');
  node('final-preview').textContent = preview;
  const bytes = bytesOf(preview);
  const tooLong = d.projectId && bytesOf(d.title) > 160;
  const notesTooLong = d.projectId && (bytesOf(d.reason) > 2048 || bytesOf(d.question) > 2048);
  node('validation').textContent = tooLong ? 'A Project source title can use up to 160 UTF-8 bytes.' :
    notesTooLong ? 'The reason and question can each use up to 2 KiB.' : '';
  node('validation').hidden = !node('validation').textContent;
  node('budget').textContent = bytes + ' / 16384 bytes';
  node('destination').disabled = busy;
  node('save').disabled = busy || !!pending || !capture || !d.title || !d.content || tooLong || notesTooLong || bytes > 16384;
  node('capture').disabled = busy || !!pending || !session;
  node('pending').hidden = !pending;
  node('recover').disabled = busy;
  node('discard').disabled = busy;
  if (pending) {
    node('pending-source').textContent = `${pending.title} · ${pending.shared ? 'Shared Project' : 'Project'} · ${pending.projectId}`;
    node('editor').hidden = true;
  }
}
async function act(fn) {
  if (busy) return;
  busy = true;
  node('error').hidden = true;
  render();
  try {
    await fn();
  } catch (e) {
    await refreshPending().catch(() => {});
    if (!session) document.getElementById('destination').textContent = 'Pero connection unavailable';
    node('error').textContent = e.message;
    node('error').hidden = false;
  } finally {
    busy = false;
    render();
  }
}
async function refreshPending() {
  pending = await request({ type: 'collectorPending' });
}
async function load() {
  await refreshPending();
  session = undefined;
  document.getElementById('destination').textContent = 'Checking connection…';
  const value = await request({ type: 'sidebar', request: { kind: 'snapshot' } });
  session = value.sessionId;
  document.getElementById('destination').textContent = 'Paired with ' + value.title;
  const projects = value.projectCollector ? (await request({
    type: 'sidebar', sessionId: session, request: { kind: 'collectorTargets' },
  })).projects : [];
  const destination = node('destination');
  const previous = destination.value;
  const previousTarget = destinations.get(previous)?.target;
  destinations = new Map(projects.map(project => [project.target ? 'shared:' + project.id : project.id, project]));
  destination.replaceChildren(new Option(`Conversation · ${value.title}`, ''),
    ...Array.from(destinations, ([key, project]) => new Option(`${project.target ? 'Shared Project' : 'Project'} · ${project.title}`, key)));
  const currentTarget = destinations.get(previous)?.target;
  if (destinations.has(previous) && previousTarget?.origin === currentTarget?.origin &&
      previousTarget?.accountId === currentTarget?.accountId) destination.value = previous;
}

async function confirmSave(saved, projectId, key, destination) {
  if (projectId && (saved.projectId !== projectId || saved.sourceReceipt?.id !== key))
    throw new Error('Pero did not confirm the selected Project and capture.');
  node('receipt').textContent = projectId
    ? `Saved to ${destination} · ${saved.sourceReceipt.title}`
    : 'Saved to conversation Artifacts · ' +
      (saved.artifactReceipt?.artifact_id || saved.artifactReceipt?.id || saved.bytes + ' bytes');
  node('success').hidden = false;
  node('editor').hidden = true;
  capture = undefined;
  if (projectId) {
    await request({ type: 'collectorForget', key });
    pending = undefined;
  }
}
node('capture').onclick = () =>
  act(async () => {
    await load();
    const next = await request({
      type: 'capture',
      scope: node('capture-scope').value,
      tabId: await currentTab(),
    });
    capture = next;
    for (const [key, value] of Object.entries({
      'source-url': next.url,
      title: next.title,
      content: next.content,
      reason: '',
      question: '',
    }))
      node(key).value = value;
    node('truncated').hidden = !next.truncated;
    node('editor').hidden = false;
    node('success').hidden = true;
  });
node('editor').oninput = render;
node('save').onclick = () =>
  act(async () => {
    const reviewed = draft();
    const key = capture.key;
    const destination = node('destination').selectedOptions[0].textContent;
    const saved = await request({ type: 'sidebar', sessionId: session, key, request: reviewed });
    await confirmSave(saved, reviewed.projectId, key, destination);
  });
node('recover').onclick = () => act(async () => {
  await load();
  if (!pending) return;
  const { id: key, projectId, shared } = pending;
  const destination = destinations.get(shared ? 'shared:' + projectId : projectId);
  const saved = await request({ type: 'collectorRecover', sessionId: session, key });
  await confirmSave(saved, projectId, key, `${shared ? 'Shared Project' : 'Project'} · ${destination?.title || projectId}`);
});
node('discard').onclick = () => act(async () => {
  await request({ type: 'collectorForget', key: pending.id });
  pending = undefined;
  capture = undefined;
});
node('another').onclick = () => {
  node('success').hidden = true;
  node('capture').focus();
};
chrome.runtime.onMessage.addListener(message => {
  if (message.type !== 'pero.relay.changed') return;
  if (message.state === 'paired') {
    void act(load);
    return;
  }
  session = undefined;
  document.getElementById('destination').textContent = 'Disconnected from Pero';
  render();
});
void act(load);
