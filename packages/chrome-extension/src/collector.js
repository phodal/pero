import { request, currentTab } from './sidebar-client.js';
const node = (id) => document.getElementById('collector-' + id);
let capture,
  session,
  busy = false;
function draft() {
  return {
    kind: 'collect',
    title: node('title').value.trim(),
    content: node('content').value.trim(),
    reason: node('reason').value.trim(),
    question: node('question').value.trim(),
  };
}
function render() {
  const d = draft();
  const preview = [
    '# ' + d.title,
    capture?.url,
    d.content,
    d.reason && '## Why collect it?\n' + d.reason,
    d.question && '## Question\n' + d.question,
  ]
    .filter(Boolean)
    .join('\n\n');
  node('final-preview').textContent = preview;
  const bytes = new TextEncoder().encode(preview).length;
  node('budget').textContent = bytes + ' / 16384 bytes';
  node('save').disabled = busy || !capture || !d.title || !d.content || bytes > 16384;
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
  document.getElementById('destination').textContent = 'Save to ' + value.title + ' · ' + value.workspace;
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
    const saved = await request({ type: 'sidebar', sessionId: session, key: capture.key, request: draft() });
    node('receipt').textContent =
      'Saved to conversation Artifacts · ' +
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
