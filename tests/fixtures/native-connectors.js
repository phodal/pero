// Runs inside the real Native App WebView, against its production Host route.
(async () => {
  const state = window.nativeConnectors = { pending: true, step: 'catalog' };
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const until = predicate => new Promise((resolve, reject) => {
    if (predicate()) return resolve();
    const observer = new MutationObserver(() => { if (predicate()) { clearTimeout(timer); observer.disconnect(); resolve(); } });
    const timer = setTimeout(() => { observer.disconnect(); reject(Error('UI condition timed out: ' + state.step + '; tiles=' + document.querySelectorAll('.point-connectors-tile').length + '; search=' + document.querySelector('input[type=search]')?.value)); }, 15000);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  });
  const request = async input => {
    const response = await fetch('/host/connectors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const value = await response.json();
    check(response.ok && value.ok, JSON.stringify(value)); return value;
  };
  const button = (text, scope = document) => [...scope.querySelectorAll('button')].find(el => el.textContent.trim() === text);
  const fill = (element, value) => {
    check(element, 'Input missing: ' + state.step);
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const snapshot = await request({ operation: 'snapshot' });
  await until(() => document.querySelectorAll('.point-connectors-tile').length === window.nativeCardCount);
  const directory = snapshot.directory.map(entry => entry.providerId).sort();
  const search = document.querySelector('input[type=search]');
  state.step = 'search';
  fill(search, 'GitHub');
  await until(() => document.querySelectorAll('.point-connectors-tile').length === 1);
  check(document.querySelector('.point-connectors-tile').textContent.includes('GitHub'), 'Search mismatch');
  state.step = 'search reset';
  fill(search, '');
  await until(() => document.querySelectorAll('.point-connectors-tile').length === window.nativeCardCount);
  const cards = [...document.querySelectorAll('.point-connectors-tile')];
  const logos = [...document.querySelectorAll('.point-connectors-logo')];
  check(logos.length >= 57 && logos.every(img => img.src.startsWith('data:')), 'Bundled logo coverage');
  const maxCardHeight = Math.max(...cards.map(card => card.getBoundingClientRect().height));
  check(maxCardHeight < 130, 'Cards exceed compact height: ' + maxCardHeight);
  check((await fetch('/host/connectors')).status === 405, 'Method boundary');
  check((await fetch('/host/connectors', { method: 'POST', body: '{' })).status === 400, 'JSON boundary');

  if (!window.nativeRestore) {
    state.step = 'import'; button('Add custom MCP').click();
    await until(() => document.querySelector('dialog[open] textarea'));
    let dialog = document.querySelector('dialog[open]');
    fill(dialog.querySelector('textarea'), JSON.stringify({ mcpServers: { fixture: { type: 'http', url: window.nativeFixture + '/mcp' } } }));
    await until(() => !button('Import and continue', dialog).disabled);
    button('Import and continue', dialog).click();
    await until(() => document.querySelector('[role=tab]'));
    dialog = document.querySelector('dialog[open]');
    button('JSON', dialog).click();
    await until(() => dialog.querySelector('textarea'));
    fill(dialog.querySelector('textarea'), JSON.stringify({ transport: 'http', url: window.nativeFixture + '/mcp', allowLoopbackHttp: true, tools: ['counter'], headers: { 'X-Resource-Key': { secretRef: 'fixture.native' } } }, null, 2));
    await until(() => !button('Save configuration', dialog).disabled);
    button('Save configuration', dialog).click();
    await until(() => dialog.textContent.includes('Configuration saved.'));
    button('Close', dialog).click();
    await until(() => !document.querySelector('dialog[open]'));
    state.step = 'credentials';
    const installed = [...document.querySelectorAll('button')].find(el => el.textContent.startsWith('Installed connections'));
    if (installed.getAttribute('aria-pressed') !== 'true') installed.click();
    await until(() => document.querySelector('button[aria-label="Details fixture"]'));
    document.querySelector('button[aria-label="Details fixture"]').click();
    await until(() => document.querySelector('input[aria-label="Secret value"]'));
    dialog = document.querySelector('dialog[open]');
    fill(dialog.querySelector('input[aria-label="Secret value"]'), 'native-fixture-private-value');
    button('Save', dialog).click();
    await until(() => dialog.textContent.includes('Secret saved.'));
    check(dialog.querySelector('input[aria-label="Secret value"]').value === '', 'Secret input retained');
    state.step = 'verify'; button('Verify connection', dialog).click();
    await until(() => dialog.textContent.includes('Verified 1 tools'));
    const counter = dialog.querySelector('input[type=checkbox]');
    check(counter?.checked, 'Expected allowed counter');
    state.step = 'tools'; counter.click();
    await until(() => !counter.checked && !!button('Save tool access', dialog));
    button('Save tool access', dialog).click();
    await until(() => !button('Save tool access', dialog));
    check((await request({ operation: 'list' })).result.find(entry => entry.connectorId === 'fixture').definition.tools.length === 0, 'Tool revocation failed');
    counter.click();
    await until(() => counter.checked && !!button('Save tool access', dialog));
    button('Save tool access', dialog).click();
    await until(() => !button('Save tool access', dialog));
    check((await request({ operation: 'list' })).result.find(entry => entry.connectorId === 'fixture').definition.tools[0] === 'counter', 'Tool grant failed');
    button('Close', dialog).click();
  } else {
    state.step = 'restart';
    const saved = (await request({ operation: 'list' })).result.find(entry => entry.connectorId === 'fixture');
    check(saved.definition.headers['X-Resource-Key'].secretRef === 'fixture.native', 'Reference lost on restart');
    check(saved.definition.tools[0] === 'counter', 'Grant lost on restart');
    await request({ operation: 'verify', connectorId: 'fixture' });
  }
  check(!JSON.stringify(await request({ operation: 'snapshot' })).includes('native-fixture-private-value'), 'Secret leaked to App projection');
  Object.assign(state, { passed: true, pending: false, directory, logos: logos.length, maxCardHeight, bridge: typeof window.pero });
})().catch(error => { window.nativeConnectors = { passed: false, error: String(error), step: window.nativeConnectors?.step }; });
