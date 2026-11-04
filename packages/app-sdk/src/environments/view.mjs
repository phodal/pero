import { METHODS, METHOD_IDS, OBSERVATION_MAX_AGE_MS, observationState, requirementText, filterMethods } from './model.mjs';
import { createInspectionSession } from './client.mjs';
import { messages } from './messages.mjs';

/** Shared DOM view: mounted by the App SDK in both the catalog and task drawer. */
export function mountEnvironmentView(root, options = {}) {
  const targets = options.targets || METHOD_IDS;
  if (!targets.length || targets.some(id => !METHOD_IDS.includes(id))) throw new Error('Unknown scientific method');
  let locale = options.locale || 'en', t = messages(locale), selected = options.selected || null;
  if (selected && !targets.includes(selected)) throw new Error('Selected method is out of scope');
  let query = '', filter = 'all', layout = 'table', tab = 'software', allBusy = false, disposed = false;
  let expires = null;
  const now = options.now || Date.now;
  const document = root.ownerDocument;
  const session = createInspectionSession({ inspect: options.inspect, changed: () => render() });
  root.classList.add('pero-env');
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined && text !== null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  };
  const append = (parent, ...children) => { parent.append(...children.filter(Boolean)); return parent; };
  function button(label, action, method, primary = false) {
    const element = node('button', label, primary ? 'env-button env-primary' : 'env-button');
    element.type = 'button'; element.dataset.action = action;
    if (method) element.dataset.method = method;
    element.dataset.focus = `${action}:${method || ''}`;
    return element;
  }
  function badge(method) {
    const record = session.records[method];
    const state = record?.state === 'loading' ? 'checking' : record?.state === 'error' ? 'error' : observationState(record?.report, now());
    return node('span', t[state], `env-status env-${state}`);
  }
  function checkButton(method) {
    const state = session.records[method]?.state;
    const action = button(state === 'loading' ? t.checking : state === 'error' ? t.retry : t.check, 'check', method);
    action.disabled = state === 'loading';
    action.setAttribute('aria-label', `${action.textContent}: ${METHODS.find(item => item.id === method).name}`);
    return action;
  }
  const time = report => report ? new Date(report.observed_at_ms).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN') : '—';
  function catalog() {
    const head = node('header', null, 'env-heading');
    const all = button(t.checkAll, 'check-all', null, true); all.disabled = allBusy;
    append(head, node('h1', t.title), all); root.append(head);
    const toolbar = node('div', null, 'env-toolbar');
    const input = node('input'); input.type = 'search'; input.placeholder = t.search; input.value = query;
    input.dataset.focus = 'search'; input.dataset.control = 'query'; input.setAttribute('aria-label', t.search);
    const select = node('select'); select.dataset.control = 'filter'; select.dataset.focus = 'filter'; select.setAttribute('aria-label', t.filter);
    for (const key of ['all', 'unchecked', 'matched', 'blocked', 'stale', 'error']) {
      const option = node('option', t[key]); option.value = key; select.append(option);
    }
    select.value = filter;
    const group = node('div', null, 'env-toggle'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'View');
    for (const mode of ['table', 'grid']) {
      const control = button(t[mode], `layout-${mode}`); control.setAttribute('aria-pressed', String(layout === mode)); group.append(control);
    }
    append(toolbar, input, select, group); root.append(toolbar);
    const methods = filterMethods(targets, query, filter, session.records, now());
    if (!methods.length) {
      root.append(append(node('div', null, 'env-empty'), node('p', t.empty), button(t.clear, 'clear')));
    } else if (layout === 'table') {
      const table = node('table', null, 'env-table env-catalog'); table.setAttribute('aria-label', t.title);
      const header = node('tr');
      for (const label of [t.method, t.app, t.status, t.actions]) { const th = node('th', label); th.scope = 'col'; header.append(th); }
      table.append(append(node('thead'), header));
      const body = node('tbody');
      for (const method of methods) {
        const row = node('tr');
        const title = button(method.name, 'open', method.id); title.className = 'env-link';
        append(row, append(node('td'), title, node('small', method.software)), node('td', method.app), append(node('td'), badge(method.id)), append(node('td'), checkButton(method.id)));
        body.append(row);
      }
      table.append(body); root.append(append(node('div', null, 'env-table-wrap'), table));
    } else {
      const grid = node('div', null, 'env-grid');
      for (const method of methods) {
        const card = node('article', null, 'env-tile');
        const title = button(method.name, 'open', method.id); title.className = 'env-link env-card-title';
        append(card, title, node('p', method.software, 'env-muted'), badge(method.id), append(node('footer'), node('span', method.app, 'env-muted'), checkButton(method.id)));
        grid.append(card);
      }
      root.append(grid);
    }
    root.append(node('p', t.noChanges, 'env-note'));
    // A failure belongs to one method and never masks other successful checks.
    const failures = targets.filter(id => session.records[id]?.state === 'error');
    for (const id of failures) {
      const method = METHODS.find(item => item.id === id);
      const error = node('p', `${method.name}: ${session.records[id].error}`, 'env-error'); error.setAttribute('role', 'alert'); root.append(error);
    }
  }
  function detail() {
    const method = METHODS.find(item => item.id === selected), record = session.records[selected], report = record?.report;
    const head = node('header', null, 'env-heading');
    const heading = node('div', null, 'env-heading-start');
    if (!options.single) heading.append(button(t.back, 'back'));
    append(heading, node('h2', method.name), badge(selected));
    append(head, heading, checkButton(selected)); root.append(head);
    root.append(node('p', `${method.app} / ${t.local}`, 'env-subtitle'));
    if (record?.state === 'loading') {
      const pending = node('p', t.checking, 'env-empty'); pending.setAttribute('role', 'status'); root.append(pending); return;
    }
    if (record?.state === 'error') {
      const error = node('p', record.error, 'env-error'); error.setAttribute('role', 'alert'); root.append(error);
    }
    if (!report) { root.append(append(node('div', null, 'env-empty'), node('p', t.unknown), node('p', t.checkPrompt, 'env-muted'))); return; }
    const observed = report.profile.observation;
    const strip = node('dl', null, 'env-facts');
    for (const [label, value] of [[t.python, `${observed.python.major}.${observed.python.minor}.${observed.python.patch}`], [t.platform, `${observed.system} / ${observed.machine}`], [t.observed, time(report)]]) {
      strip.append(append(node('div'), node('dt', label), node('dd', value)));
    }
    root.append(strip);
    if (observationState(report, now()) === 'stale') root.append(node('p', t.expired, 'env-warning'));
    if (report.missing.length) {
      const warning = node('section', null, 'env-warning'); warning.setAttribute('aria-label', t.blocked);
      warning.append(node('strong', t.blocked));
      const list = node('ul'); for (const item of report.missing) list.append(node('li', requirementText(item)));
      append(warning, list, node('p', t.missingNote)); root.append(warning);
    }
    const tabs = node('nav', null, 'env-tabs'); tabs.setAttribute('aria-label', t.details);
    for (const key of ['software', 'requirements', 'observation']) {
      const control = button(t[key], `tab-${key}`); control.setAttribute('aria-pressed', String(tab === key)); tabs.append(control);
    }
    root.append(tabs);
    if (tab === 'software') {
      const table = node('table', null, 'env-table'); table.setAttribute('aria-label', t.software);
      const row = node('tr'); for (const label of [t.package, t.version]) { const th = node('th', label); th.scope = 'col'; row.append(th); }
      table.append(append(node('thead'), row)); const body = node('tbody');
      for (const [name, version] of Object.entries(observed.packages)) body.append(append(node('tr'), node('td', name), node('td', version ?? t.missing, version === null ? 'env-missing' : undefined)));
      for (const [name, program] of Object.entries(observed.native)) body.append(append(node('tr'), node('td', name), node('td', program.status === 'observed' ? (program.version ?? t.missing) : (t[program.status] || program.status), program.status !== 'observed' ? 'env-missing' : undefined)));
      table.append(body); root.append(append(node('div', null, 'env-table-wrap'), table));
    } else if (tab === 'requirements') {
      const list = node('ul', null, 'env-requirements');
      for (const item of report.requirements.required) list.append(node('li', requirementText(item)));
      root.append(list);
    } else {
      const facts = node('dl', null, 'env-observation');
      for (const [label, value] of [[t.identity, report.profile.id], [t.evidence, t.metadata], [t.observed, time(report)]]) append(facts, node('dt', label), node('dd', value));
      root.append(facts);
      const disclosure = node('details'); disclosure.append(node('summary', 'JSON'), node('pre', JSON.stringify(report, null, 2), 'env-json')); root.append(disclosure);
    }
    const footer = node('footer', null, 'env-footer');
    append(footer, node('p', t.scope, 'env-note'), button(t.export, 'export', selected)); root.append(footer);
  }
  function render() {
    if (disposed) return;
    const active = document.activeElement;
    const focus = root.contains(active) ? active?.dataset.focus : null;
    // Selection APIs are unavailable on select/buttons.
    const selection = active?.tagName === 'INPUT' ? [active.selectionStart, active.selectionEnd] : null;
    root.replaceChildren(); selected ? detail() : catalog();
    clearTimeout(expires);
    const current = now();
    const next = Object.values(session.records).flatMap(record => {
      if (!record.report) return [];
      const observed = record.report.observed_at_ms;
      const at = observed > current ? observed : observed + OBSERVATION_MAX_AGE_MS + 1;
      return at > current ? [at] : [];
    });
    if (next.length) expires = setTimeout(render, Math.min(2147483647, Math.max(1, Math.min(...next) - current)));
    if (focus) {
      const element = [...root.querySelectorAll('[data-focus]')].find(item => item.dataset.focus === focus);
      if (element && !element.disabled) { element.focus({ preventScroll: true }); if (selection && element.type === 'search') element.setSelectionRange(...selection); }
    }
  }
  async function click(event) {
    const button = event.target.closest('button[data-action]'); if (!button || !root.contains(button) || button.disabled) return;
    const action = button.dataset.action, method = button.dataset.method;
    if (action === 'check') { await session.check(method); return; }
    if (action === 'check-all') {
      allBusy = true; render();
      try { for (const id of targets) { if (disposed) break; await session.check(id); } }
      finally { allBusy = false; render(); }
      return;
    }
    if (action === 'open') { selected = method; tab = 'software'; }
    else if (action === 'back') selected = null;
    else if (action === 'clear') { query = ''; filter = 'all'; }
    else if (action.startsWith('layout-')) layout = action.slice(7);
    else if (action.startsWith('tab-')) tab = action.slice(4);
    else if (action === 'export') {
      const report = session.records[method]?.report; if (!report) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }));
      const anchor = node('a'); anchor.href = url; anchor.download = `environment-${method}-${report.observed_at_ms}.json`;
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
    }
    render();
    if (action === 'open' || action === 'back') { const heading = root.querySelector('h1,h2'); heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
  const input = event => {
    if (event.target.dataset.control === 'query') { query = event.target.value; render(); }
    if (event.target.dataset.control === 'filter') { filter = event.target.value; render(); }
  };
  root.addEventListener('click', click); root.addEventListener('input', input);
  render();
  // Only the task's explicit inspector affordance requests an initial observation.
  if (options.autoInspect && selected) void session.check(selected);
  return {
    setLocale(value) { locale = value; t = messages(value); render(); },
    dispose() { disposed = true; clearTimeout(expires); session.dispose(); root.removeEventListener('click', click); root.removeEventListener('input', input); root.replaceChildren(); },
  };
}

/** Native dialog handles escape, focus containment and return to the task. */
export function mountEnvironmentInspector(root, options = {}) {
  const document = root.ownerDocument, targets = options.targets || METHOD_IDS;
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'env-button';
  trigger.textContent = messages(options.locale).inspect; trigger.setAttribute('aria-haspopup', 'dialog');
  const dialog = document.createElement('dialog'); dialog.className = 'pero-env-dialog'; dialog.setAttribute('aria-label', messages(options.locale).title);
  const close = document.createElement('button'); close.type = 'button'; close.className = 'env-button env-dialog-close'; close.textContent = messages(options.locale).close;
  const content = document.createElement('div'); dialog.append(close, content); root.classList.add('pero-env-trigger'); root.append(trigger, dialog);
  let mounted = null;
  function open() {
    if (dialog.open) return;
    mounted = mountEnvironmentView(content, { ...options, selected: targets.length === 1 ? targets[0] : null, single: targets.length === 1, autoInspect: targets.length === 1 });
    dialog.showModal(); close.focus();
  }
  function closed() { mounted?.dispose(); mounted = null; trigger.focus({ preventScroll: true }); }
  function dismiss() { dialog.close(); }
  trigger.addEventListener('click', open); close.addEventListener('click', dismiss); dialog.addEventListener('close', closed);
  return { dispose() { trigger.removeEventListener('click', open); close.removeEventListener('click', dismiss); dialog.removeEventListener('close', closed); mounted?.dispose(); if (dialog.open) dialog.close(); root.replaceChildren(); } };
}
