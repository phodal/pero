const node = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const code = node<HTMLTextAreaElement>('code');
const pair = node<HTMLButtonElement>('connect');
const stop = node<HTMLButtonElement>('stop');

type Status = { state: 'disconnected' | 'connecting' | 'paired'; error?: string; label?: string };
let busy = false;

async function request(message: object) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response) throw new Error('Reload Pero Browser Use in Chrome, then pair again from Pero settings.');
  if (!response.ok) throw new Error(response.error);
  return response.value as Status;
}

function render({ state, error, label }: Status) {
  const labels = { disconnected: 'Disconnected', connecting: 'Connecting to Pero…', paired: 'Connected' };
  node('status').textContent = labels[state] + (state !== 'disconnected' && label ? ' · ' + label : '');
  node('pair').hidden = state !== 'disconnected';
  node('access').hidden = state !== 'paired';
  stop.hidden = state === 'disconnected';
  node('error').textContent = error ?? '';
  node('error').hidden = !error;
}

async function action(fn: () => Promise<Status>) {
  if (busy) return;
  busy = pair.disabled = stop.disabled = true;
  node('error').hidden = true;
  try { render(await fn()); }
  catch (error) {
    node('error').textContent = error instanceof Error ? error.message : String(error);
    node('error').hidden = false;
  } finally {
    busy = pair.disabled = stop.disabled = false;
  }
}

pair.addEventListener('click', () => void action(async () => {
  const status = await request({ type: 'pair', code: code.value });
  code.value = '';
  return status;
}));
stop.addEventListener('click', () => void action(() => request({ type: 'stop' })));
chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'pero.relay.changed') render(message);
});

const handoff = new URLSearchParams(location.hash.slice(1)).get('pair');
if (handoff) {
  history.replaceState(null, '', location.pathname);
  void action(() => request({ type: 'pair', code: handoff }));
} else {
  void action(() => request({ type: 'status' }));
}
