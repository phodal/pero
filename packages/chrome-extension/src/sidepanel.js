// Conversation controls and keyboard navigation ported from Point's side panel.
import { bindNativeComposer, editorChange } from './native-composer.js';
import MarkdownIt from 'markdown-it';
import { request, currentTab } from './sidebar-client.js';
const md = new MarkdownIt({ html: false });
md.renderer.rules.image = (tokens, i) => md.utils.escapeHtml(tokens[i].content || 'Image');
md.renderer.rules.link_open = (tokens, i, options, env, renderer) => {
  tokens[i].attrSet('target', '_blank');
  tokens[i].attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, i, options);
};
const nodes = Object.fromEntries([...document.querySelectorAll('[id]')].map((node) => [node.id, node]));
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGES = 4,
  MAX_IMAGE_BYTES = 8 * 1024 * 1024;
let snapshot,
  busy = false,
  draftAttachments = [],
  draftError = '',
  unavailable = '',
  timer;
const rpc = (kind, fields = {}) =>
  request({ type: 'sidebar', sessionId: snapshot?.sessionId, request: { kind, ...fields } });
function appendAttachment(container, attachment, removableIndex) {
  const chip = document.createElement('span');
  chip.className = 'attachment-chip';
  const label = document.createElement('span');
  label.textContent = `${attachment.name} · ${Math.max(1, Math.round(attachment.bytes / 1024))} KiB`;
  chip.append(label);
  if (Number.isInteger(removableIndex)) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${attachment.name}`);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const first = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    first.setAttribute('d', 'M7 7l10 10');
    const second = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    second.setAttribute('d', 'M17 7 7 17');
    icon.append(first, second);
    remove.append(icon);
    remove.addEventListener('click', () => {
      draftAttachments.splice(removableIndex, 1);
      draftError = '';
      render();
    });
    chip.append(remove);
  }
  container.append(chip);
}

function renderSessionMenu() {
  const select = nodes['session-select'],
    query = nodes['session-search'].value.trim().toLowerCase();
  const selected = select.selectedOptions[0];
  nodes['session-label'].textContent = selected?.textContent || snapshot?.title || 'Pero Chat';
  nodes['session-search'].hidden = select.options.length <= 8;
  const rows = [...select.options]
    .filter((option) => !query || option.textContent.toLowerCase().includes(query))
    .map((option) => {
      const item = document.createElement('button'),
        text = document.createElement('span');
      item.type = 'button';
      item.className = 'session-option';
      item.role = 'option';
      item.dataset.value = option.value;
      item.dataset.state = option.dataset.state || '';
      item.setAttribute('aria-selected', String(option.value === select.value));
      text.textContent = option.textContent;
      item.append(text);

      return item;
    });
  nodes['session-list'].replaceChildren(...rows);
  nodes['session-empty'].hidden = rows.length > 0;
}
function setMoreMenu(open) {
  nodes['more-menu'].hidden = !open;
  nodes['more-trigger'].setAttribute('aria-expanded', String(open));
  if (open) {
    setSessionMenu(false);
    nodes['more-menu'].querySelector('[role="menuitem"]:not(:disabled)')?.focus();
  }
}
function setSessionMenu(open) {
  const trigger = nodes['session-trigger'],
    menu = nodes['session-menu'];
  if (open && trigger.disabled) return;
  menu.hidden = !open;
  trigger.setAttribute('aria-expanded', String(open));
  if (open) setMoreMenu(false);
  if (!open) return;
  nodes['session-search'].value = '';
  renderSessionMenu();
  const current = menu.querySelector('[aria-selected="true"]');
  if (!nodes['session-search'].hidden) nodes['session-search'].focus();
  else (current ?? nodes['session-list'].firstElementChild)?.focus();
  current?.scrollIntoView({ block: 'nearest' });
}
nodes['session-trigger'].addEventListener('click', () => setSessionMenu(nodes['session-menu'].hidden));
nodes['session-search'].addEventListener('input', renderSessionMenu);
nodes['session-menu'].addEventListener('click', (event) => {
  const item = event.target.closest('.session-option');
  if (!item) return;
  setSessionMenu(false);
  nodes['session-trigger'].focus();
  if (item.dataset.value !== nodes['session-select'].value) {
    nodes['session-select'].value = item.dataset.value;
    nodes['session-select'].dispatchEvent(new Event('change'));
  }
});
nodes['session-menu'].addEventListener('keydown', (event) => {
  const items = [...nodes['session-list'].children],
    index = items.indexOf(document.activeElement);
  if (
    event.target === nodes['session-search'] &&
    event.key !== 'ArrowDown' &&
    event.key !== 'Escape' &&
    event.key !== 'Enter'
  )
    return;
  if (event.key === 'ArrowDown') items[Math.min(index + 1, items.length - 1)]?.focus();
  else if (event.key === 'Enter' && event.target === nodes['session-search']) items[0]?.click();
  else if (event.key === 'ArrowUp') items[Math.max(index - 1, 0)]?.focus();
  else if (event.key === 'Home') items[0]?.focus();
  else if (event.key === 'End') items.at(-1)?.focus();
  else if (event.key === 'Escape' || event.key === 'Tab') {
    setSessionMenu(false);
    nodes['session-trigger'].focus();
  } else return;
  event.preventDefault();
});
nodes['more-trigger'].addEventListener('click', () => setMoreMenu(nodes['more-menu'].hidden));
nodes['more-menu'].addEventListener('click', () => setMoreMenu(false));
nodes['more-menu'].addEventListener('keydown', (event) => {
  const items = [...nodes['more-menu'].querySelectorAll('[role="menuitem"]:not(:disabled)')],
    index = items.indexOf(document.activeElement);
  if (event.key === 'ArrowDown') items[(index + 1) % items.length]?.focus();
  else if (event.key === 'ArrowUp') items[(index - 1 + items.length) % items.length]?.focus();
  else if (event.key === 'Escape' || event.key === 'Tab') {
    setMoreMenu(false);
    nodes['more-trigger'].focus();
  } else return;
  event.preventDefault();
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.header-menu, .header-actions')) {
    setSessionMenu(false);
    setMoreMenu(false);
  }
});

const draftPrefix = 'pero.chat.draft.' + (await chrome.windows.getCurrent()).id + '.';
let previousMessages, previousSessions, draftSession;
const draftKey = () => draftPrefix + (draftSession || 'unpaired');
function storeDraft() {
  if (nodes.prompt.value) localStorage.setItem(draftKey(), nodes.prompt.value);
  else localStorage.removeItem(draftKey());
}
nodes.prompt.value = localStorage.getItem(draftKey()) || '';
let chain = Promise.resolve(),
  dirty = false;
function enqueue(fn) {
  const result = chain.then(fn);
  chain = result.catch(() => {});
  return result;
}
function accept(next) {
  snapshot = next;
  if (!dirty && next?.composer && nodes.prompt.value !== next.composer.text) {
    nodes.prompt.value = next.composer.text;
    storeDraft();
    resizeComposer();
  }
}
async function syncDraft() {
  if (!snapshot?.composer || !dirty) return;
  const text = nodes.prompt.value;
  if (snapshot.composer.text !== text) {
    let next;
    try {
      next = await rpc('edit', editorChange(snapshot.composer.text, text));
    } catch (error) {
      if (error.message.includes('The draft changed in Pero')) {
        dirty = false;
        draftError = error.message;
      }
      throw error;
    }
    dirty = text !== nodes.prompt.value;
    accept(next);
  } else dirty = false;
}
const drawComposer = bindNativeComposer(
  nodes.prompt,
  nodes['native-model'],
  nodes['native-picker'],
  nodes['native-references'],
  (kind, fields) =>
    perform(() =>
      enqueue(async () => {
        await syncDraft();
        accept(await rpc(kind, fields));
        nodes.prompt.focus();
      }),
    ),
);
function render() {
  const ready = !!snapshot,
    running = snapshot?.running;
  nodes.status.textContent = busy ? 'Sending…' : running ? 'Responding…' : snapshot?.composer?.sessionReady === false ? 'Resume in Pero' : ready ? 'Ready' : 'Pair to send';
  nodes.connection.textContent = ready ? 'Connected to Pero' : 'Disconnected';
  nodes['connection-dot'].dataset.state = ready ? 'ready' : 'error';
  nodes['more-trigger'].dataset.state = ready ? '' : 'offline';
  nodes['session-label'].textContent = snapshot?.title || 'Pero Chat';
  const signature = JSON.stringify([snapshot?.sessionId, snapshot?.sessions]);
  if (signature !== previousSessions) {
    previousSessions = signature;
    nodes['session-select'].replaceChildren(
      ...(snapshot?.sessions || []).map((s) => new Option(s.title, s.id)),
    );
    nodes['session-select'].value = snapshot?.sessionId || '';
    renderSessionMenu();
  }
  drawComposer(snapshot?.composer, running);
  const messages = JSON.stringify(snapshot?.messages || []);
  if (previousMessages !== messages) {
    previousMessages = messages;
    const atEnd = nodes.messages.scrollHeight - nodes.messages.scrollTop - nodes.messages.clientHeight < 48;
    nodes.messages.replaceChildren();
    for (const message of snapshot?.messages || []) {
      const article = document.createElement('article'),
        label = document.createElement('span'),
        bubble = document.createElement('div');
      article.className = 'message';
      article.dataset.role = message.role;
      label.className = 'message-label';
      label.textContent = message.role === 'user' ? 'You' : 'Pero';
      bubble.className = 'bubble';
      bubble.innerHTML = md.render(message.text);
      article.append(label, bubble);
      for (const name of message.files || []) {
        const chip = document.createElement('span');
        chip.className = 'attachment-chip';
        chip.textContent = name;
        article.append(chip);
      }
      nodes.messages.append(article);
    }
    if (!nodes.messages.childElementCount) nodes.messages.append(nodes.empty);
    if (atEnd) nodes.messages.scrollTop = nodes.messages.scrollHeight;
  }
  nodes.attention.textContent =
    unavailable || snapshot?.composer?.error || snapshot?.error || (snapshot?.attention ? 'Review the request in Pero.' : '');
  nodes.attention.hidden = !nodes.attention.textContent;
  nodes['attachment-error'].textContent = draftError;
  nodes['attachment-error'].hidden = !draftError;
  nodes['draft-attachments'].replaceChildren();
  draftAttachments.forEach((a, i) => appendAttachment(nodes['draft-attachments'], a, i));
  nodes['open-point'].disabled = !ready || busy;
  nodes.prompt.readOnly = busy;
  for (const id of ['share-tab', 'attach', 'new-chat', 'session-trigger'])
    nodes[id].disabled = !ready || busy || !!running;
  nodes.send.hidden = !!running;
  nodes.stop.hidden = !running;
  nodes.send.disabled =
    !ready || busy || !!running || snapshot?.composer?.sessionReady === false || (!nodes.prompt.value.trim() && !draftAttachments.length);
}
async function refresh() {
  clearTimeout(timer);
  try {
    await enqueue(async () => {
      await syncDraft();
      const next = await rpc('snapshot');
      if (next.sessionId !== draftSession) {
        const unpaired = !draftSession && nodes.prompt.value;
        draftSession = next.sessionId;
        nodes.prompt.value = unpaired || localStorage.getItem(draftKey()) || '';
        if (unpaired) {
          storeDraft();
          localStorage.removeItem(draftPrefix + 'unpaired');
        }
        dirty = !!nodes.prompt.value && !next.composer?.text;
        resizeComposer();
        draftAttachments = [];
        draftError = '';
      }
      accept(next);
      await syncDraft();
      unavailable = '';
    });
  } catch (error) {
    snapshot = undefined;
    unavailable = error.message;
  }
  render();
  clearTimeout(timer);
  timer = setTimeout(refresh, snapshot?.composer?.open ? 250 : snapshot?.running ? 450 : 1400);
}
async function perform(action) {
  if (busy) return;
  busy = true;
  render();
  try {
    await action();
  } catch (error) {
    draftError = error.message;
  } finally {
    busy = false;
    render();
  }
}
function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
function resizeComposer() {
  nodes.prompt.style.height = 'auto';
  nodes.prompt.style.height = `${Math.min(nodes.prompt.scrollHeight, 164)}px`;
}
async function addFiles(files) {
  draftError = '';
  if (draftAttachments.length + files.length > MAX_IMAGES)
    throw new Error(`Attach at most ${MAX_IMAGES} images.`);
  const next = [],
    existingBytes = draftAttachments.reduce((sum, item) => sum + item.bytes, 0);
  let total = existingBytes;
  for (const file of files) {
    if (!IMAGE_TYPES.has(file.type)) throw new Error(`${file.name || 'File'} is not a supported image.`);
    total += file.size;
    if (file.size <= 0 || total > MAX_IMAGE_BYTES) throw new Error('Attachments must total 8 MiB or less.');
    const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    next.push({
      name: String(file.name || 'Image')
        .replace(/[\x00-\x1f]/g, ' ')
        .slice(0, 200),
      mediaType: file.type,
      data,
      bytes: file.size,
    });
  }
  draftAttachments.push(...next);
}

nodes.prompt.addEventListener('input', () => {
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(refresh, 100);
  storeDraft();
  resizeComposer();
  render();
});
nodes.prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!nodes.send.disabled) nodes.send.click();
  }
});
nodes.attach.addEventListener('click', () => nodes['attachment-input'].click());
nodes['attachment-input'].addEventListener(
  'change',
  () =>
    void perform(async () => {
      try {
        await addFiles([...nodes['attachment-input'].files]);
      } catch (error) {
        draftError = error.message;
      } finally {
        nodes['attachment-input'].value = '';
      }
    }),
);

nodes['share-tab'].onclick = () =>
  perform(async () => {
    if (draftAttachments.length >= MAX_IMAGES) throw new Error('Attach at most four images.');
    const image = await request({ type: 'share', tabId: await currentTab() });
    const bytes = Math.ceil((image.base64.length * 3) / 4);
    if (draftAttachments.reduce((n, a) => n + a.bytes, bytes) > MAX_IMAGE_BYTES)
      throw new Error('Attachments exceed 8 MiB.');
    draftAttachments.push({ name: 'Tab screenshot.png', mediaType: 'image/png', data: image.base64, bytes });
    draftError = '';
  });
nodes.send.onclick = () =>
  perform(async () => {
    const contexts = draftAttachments.map((a) => ({
      id: crypto.randomUUID(),
      kind: 'image',
      source: 'chrome-sidebar',
      label: a.name,
      content: { type: 'image', mime_type: a.mediaType, data: a.data },
    }));
    if (snapshot?.composer) {
      await enqueue(async () => {
        await syncDraft();
        accept(await rpc('submit', { text: nodes.prompt.value, contexts }));
      });
      draftAttachments = [];
      draftError = '';
      await refresh();
      return;
    }
    await rpc('send', { text: nodes.prompt.value.trim(), contexts });
    nodes.prompt.value = '';
    storeDraft();
    draftAttachments = [];
    draftError = '';
    resizeComposer();
    await refresh();
  });
nodes.stop.onclick = () =>
  perform(async () => {
    await rpc('stop');
    await refresh();
  });
nodes['open-point'].onclick = () => perform(() => rpc('open'));
nodes['new-chat'].onclick = () => perform(() => rpc('create'));
nodes['session-select'].onchange = () => perform(() => rpc('select', { id: nodes['session-select'].value }));
nodes['open-relay'].onclick = () =>
  chrome.windows.create({ url: chrome.runtime.getURL('relay.html'), type: 'popup', width: 460, height: 440 });
void refresh();
