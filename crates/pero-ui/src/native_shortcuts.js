// Native App WebView adapter. Command policy and effective bindings come from Rust.
addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.repeat) return;
  for (const entry of window.peroShortcutMenu?.entries ?? []) {
    if (!entry.application_entry) continue;
    for (const accelerator of entry.accelerators) {
      const parts = accelerator.toLowerCase().split('+');
      const key = parts.pop();
      const expected = key === 'plus' ? '+' : key === 'minus' ? '-' : key === 'space' ? ' ' : key;
      if (event.key.toLowerCase().replace(/^arrow/, '') === expected && event.metaKey === parts.includes('super') &&
          event.ctrlKey === parts.includes('control') && event.altKey === parts.includes('alt') && event.shiftKey === parts.includes('shift')) {
        event.preventDefault();
        event.stopPropagation();
        window.ipc.postMessage(JSON.stringify({type:'pero:shortcut', command:entry.command}));
        return;
      }
    }
  }
});
