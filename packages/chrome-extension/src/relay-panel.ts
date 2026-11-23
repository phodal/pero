// The review nonce and explicit Allow/Stop controls follow Point relay-panel.js (2449d4b98).
import { webOrigin } from './protocol.ts';

const node = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const status = node('status');
const code = node<HTMLTextAreaElement>('code');
const tabs = node<HTMLSelectElement>('tab');
const pair = node<HTMLButtonElement>('connect');
const review = node<HTMLButtonElement>('review');
const allow = node<HTMLButtonElement>('allow');
let consent: string | undefined;
let busy = false;

async function request(message: object) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response.ok) throw new Error(response.error);
  return response.value;
}
async function choices(approvedTabIds: number[]) {
  const selected = tabs.value;
  const available = await chrome.tabs.query({ active: true });
  const entries = available.filter(tab => tab.status === 'complete' && !tab.incognito &&
    Number.isInteger(tab.id) && !approvedTabIds.includes(tab.id!) && webOrigin(tab.url ?? '')).map(tab => {
    const entry = document.createElement('option');
    entry.value = String(tab.id);
    entry.textContent = `${tab.title || 'Chrome tab'} · ${webOrigin(tab.url!)}`;
    return entry;
  });
  tabs.replaceChildren(...(entries.length ? entries : [new Option('Switch to an unapproved tab in Chrome', '')]));
  tabs.disabled = entries.length === 0;
  if ([...tabs.options].some(option => option.value === selected)) tabs.value = selected;
}
function clearReview() {
  consent = undefined;
  node('preview').hidden = true;
}
async function render(value?: {state: string; error?: string; label?: string; approvedTabIds: number[]}) {
  const state = value ?? await request({ type: 'status' });
  const paired = state.state === 'paired' || state.state === 'approved';
  status.textContent = ({
    disconnected: 'Disconnected',
    connecting: 'Connecting to Pero…',
    paired: 'Paired · awaiting tab approval',
    authorizing: 'Allowing the reviewed tab…',
    approved: 'Browser Use allowed',
  } as Record<string, string>)[state.state] + (state.state !== 'disconnected' && state.label ? ` · ${state.label}` : '');
  const count = state.approvedTabIds.length;
  if (count) status.textContent += ` · ${count} approved ${count === 1 ? 'tab' : 'tabs'}`;
  node('pair').hidden = state.state !== 'disconnected';
  node('choose').hidden = !paired;
  node('stop').hidden = state.state === 'disconnected';
  node('error').textContent = state.error ?? '';
  node('error').hidden = !state.error;
  if (!paired) clearReview();
  else await choices(state.approvedTabIds);
  review.disabled = busy || !tabs.value;
  pair.disabled = allow.disabled = busy;
}
async function action(fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  pair.disabled = review.disabled = allow.disabled = true;
  node('error').hidden = true;
  try { await fn(); }
  catch (error) {
    node('error').textContent = error instanceof Error ? error.message : String(error);
    node('error').hidden = false;
  } finally {
    busy = false;
    pair.disabled = allow.disabled = false;
    review.disabled = !tabs.value;
  }
}
pair.addEventListener('click', () => void action(async () => {
  await render(await request({ type: 'pair', code: code.value }));
  code.value = '';
}));
tabs.addEventListener('change', clearReview);
review.addEventListener('click', () => void action(async () => {
  clearReview();
  const preview = await request({ type: 'preview', tabId: Number(tabs.value) });
  consent = preview.nonce;
  node('title').textContent = preview.title || 'Chrome tab';
  node('url').textContent = preview.url;
  node('preview').hidden = false;
  allow.focus();
}));
allow.addEventListener('click', () => void action(async () => {
  const nonce = consent;
  clearReview();
  await render(await request({ type: 'allow', nonce }));
}));
node('stop').addEventListener('click', () => void action(async () => {
  await render(await request({ type: 'stop' }));
}));
chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'pero.relay.changed') void render(message);
});
chrome.tabs.onActivated.addListener(() => {
  if (!node('choose').hidden) { clearReview(); void render(); }
});
chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (!node('choose').hidden && tab.active && (change.url || change.status === 'complete')) {
    if (change.url) clearReview();
    void render();
  }
});
void render();
