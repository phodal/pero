import { request, currentTab } from './sidebar-client.js';
const node = (id) => document.getElementById('collector-' + id);
let capture,
  session,
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
  node('save').disabled = busy || !capture || !d.title || !d.content || tooLong || notesTooLong || bytes > 16384;
  node('capture').disabled = busy || !session;
}
async function act(fn) {
  if (busy) return;
  busy = true;
  node('error').hidden = true;
  render();
  try {
    await fn();
  } catch (e) {
    node('error').textContent = e.message;
    node('error').hidden = false;
  } finally {
    busy = false;
    render();
  }
}
async function load() {
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
    const saved = await request({ type: 'sidebar', sessionId: session, key: capture.key, request: reviewed });
    if (reviewed.projectId && saved.projectId !== reviewed.projectId)
      throw new Error('Pero did not confirm the selected Project. Check the saved sources before retrying.');
    node('receipt').textContent = reviewed.projectId
      ? `Saved to ${node('destination').selectedOptions[0].textContent} · ${saved.sourceReceipt.title}`
      : 'Saved to conversation Artifacts · ' +
        (saved.artifactReceipt?.artifact_id || saved.artifactReceipt?.id || saved.bytes + ' bytes');
    node('success').hidden = false;
    node('editor').hidden = true;
    capture = undefined;
  });
node('another').onclick = () => {
  node('success').hidden = true;
  node('capture').focus();
};
void act(load);
