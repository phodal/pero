export async function request(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error || 'Reload Pero Browser Use and pair from Native settings.');
  return reply.value;
}
export async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Select a loaded browser tab.');
  return tab.id;
}
