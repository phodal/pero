// Chrome renders the controls. The Native ChatPanel owns candidates, tokens and model selection.
export function bindNativeComposer(prompt, model, picker, refs, command) {
  let current,
    selected = 0,
    signature = '';
  const choose = (index) =>
    command('choose', { index, text: current.text, label: current.items[index].label });
  model.onchange = () => command('model', { id: model.value });
  function highlight() {
    [...picker.children].forEach((row, i) => row.setAttribute('aria-selected', String(i === selected)));
    picker.children[selected]?.scrollIntoView({ block: 'nearest' });
  }
  prompt.addEventListener(
    'keydown',
    (e) => {
      if (!current?.open || e.isComposing || e.shiftKey) return;
      if (e.key === 'Escape') command('dismiss', {});
      else if (!current.items.length) return;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        selected =
          (selected + (e.key === 'ArrowDown' ? 1 : -1) + current.items.length) % current.items.length;
        highlight();
      } else if (e.key === 'Enter' || e.key === 'Tab') choose(selected);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
  return (state, running) => {
    current = state;
    model.hidden = !state?.models?.length;
    if (state) {
      const options = JSON.stringify(state.models);
      if (model.dataset.options !== options) {
        model.dataset.options = options;
        model.replaceChildren(...state.models.map(([id, label]) => new Option(label, id)));
      }
      model.value = state.model;
      model.disabled = running || state.modelDisabled;
    }
    refs.textContent = state?.references.join(' · ') || '';
    picker.hidden = !state?.open || !state.items.length;
    const next = JSON.stringify([state?.text, state?.items]);
    if (next === signature) return;
    signature = next;
    selected = 0;
    picker.replaceChildren(
      ...(state?.items || []).map((item, i) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.role = 'option';
        row.textContent = item.label;
        row.title = [item.group, item.detail].filter(Boolean).join(' · ');
        row.onmousedown = (e) => e.preventDefault();
        row.onclick = () => choose(i);
        return row;
      }),
    );
    if (!picker.hidden) highlight();
  };
}

// Compute the changed byte range only. Native retains tokens outside the edit.
export function editorChange(before, after) {
  const a = Array.from(before),
    b = Array.from(after);
  let start = 0,
    tail = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    tail < a.length - start &&
    tail < b.length - start &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const bytes = new TextEncoder();
  return {
    before,
    start: bytes.encode(a.slice(0, start).join('')).length,
    end: bytes.encode(a.slice(0, a.length - tail).join('')).length,
    insert: b.slice(start, b.length - tail).join(''),
  };
}
