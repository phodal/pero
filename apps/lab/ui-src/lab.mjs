/** Framework-free view; the production entry supplies the existing Pero SDK bridge. */
export function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'className') node.className = value;
    else if (key in node && !key.startsWith('aria-')) node[key] = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false)
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
const h = element;
const positions = Array.from({ length: 96 }, (_, i) => `${'ABCDEFGH'[Math.floor(i / 12)]}${i % 12 + 1}`);
const rounded = value => value == null ? '—' : Number(value).toLocaleString('en', { maximumFractionDigits: 5 });
export function comparableDelta(trial, parent) {
  const a = trial?.verification, b = parent?.verification;
  if (a?.absolute_error == null || b?.absolute_error == null || a.origin !== b.origin) return null;
  return a.absolute_error - b.absolute_error;
}

/**
 * @param {HTMLElement} root
 * @param {{get: (path:string) => Promise<any>, post: (path:string, body:any) => Promise<any>, ask: (text:string) => void}} bridge
 */
export function mountLab(root, bridge) {
  let catalog = { experiments: [], capability: { available: false }, example_steps: [] };
  let experiment = null, selected = '', tab = 'Deck', well = 'B1';
  let creating = false, draft = null, error = '', busy = false, loading = true;
  let disposed = false, timer = null, epoch = 0;
  const trial = () => experiment?.trials.find(item => item.id === selected);
  const running = () => experiment?.trials.some(item => item.status === 'running');
  const button = (label, action, disabled = false, primary = false) => h('button', {
    type: 'button', className: primary ? 'primary' : '', disabled: busy || disabled,
    onClick: () => action(),
  }, label);
  const badge = (label, status = '') => h('span', { className: `badge ${status.toLowerCase()}` }, label);

  function setExperiment(next, preferLatest = false) {
    const changed = experiment?.id !== next.id;
    experiment = next;
    if (changed || preferLatest || !next.trials.some(item => item.id === selected))
      selected = next.trials.at(-1)?.id ?? '';
    if (changed) draft = null;
    creating = false;
  }
  async function refresh() {
    const request = ++epoch;
    try {
      const nextCatalog = await bridge.get('/api/experiments');
      const next = experiment && await bridge.get(`/api/experiments/${experiment.id}`);
      if (disposed || request !== epoch) return;
      catalog = nextCatalog;
      if (next) setExperiment(next);
      error = '';
    } catch (failure) {
      if (!disposed && request === epoch) error = String(failure.message ?? failure);
    } finally {
      if (!disposed && request === epoch) { loading = false; render(); schedule(); }
    }
  }
  function schedule() {
    clearTimeout(timer);
    if (running() && !disposed) timer = setTimeout(refresh, 400);
  }
  async function perform(action) {
    if (busy) return;
    busy = true; error = ''; ++epoch;
    render();
    try { await action(); }
    catch (failure) { error = String(failure.message ?? failure); }
    finally { busy = false; if (!disposed) { render(); schedule(); } }
  }
  async function act(action, extra = {}) {
    const next = await bridge.post('/api/agent-step', {
      action, experiment_id: experiment.id, ...extra,
      ...(['read', 'observe', 'compare', 'propose'].includes(action) ? {} : { trial_id: selected }),
    });
    setExperiment(next, action === 'propose');
  }
  function select(identity) {
    perform(async () => { setExperiment(await bridge.get(`/api/experiments/${identity}`)); tab = 'Deck'; });
  }
  function newDraft(parent = null) {
    draft = { steps: JSON.stringify(parent?.steps ?? catalog.example_steps, null, 2),
              parent_id: parent?.id ?? null, reason: '' };
    tab = 'Protocol'; render();
  }
  function ask() {
    if (!experiment) return;
    perform(() => bridge.ask(`Use Lab's declared lab-step App tool for experiment ${experiment.id}. Read its frozen inputs first (hash ${experiment.input_hash}). Propose a bounded typed protocol; validate and run only the no-hardware simulation. Use explicitly synthetic observations only when requested; never call predictions measured data. Evaluate against the frozen target, inspect failures, and propose one linked revision within the remaining trial budget. Report unchanged or worse results honestly. Do not change policy, import invented measurements, or accept results on my behalf.`));
  }
  function exportRecord() {
    perform(async () => {
      const record = await bridge.get(`/api/export/${experiment.id}`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
      const anchor = h('a', { href: url, download: `lab-${record.id}.json` });
      root.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function specForm() {
    const objective = h('input', { name: 'objective', required: true, maxLength: 500,
      value: 'Match a virtual dye target' });
    const target = h('input', { type: 'number', name: 'target_fraction', min: 0, max: 1, step: 'any', value: '0.5', required: true });
    const tolerance = h('input', { type: 'number', name: 'tolerance', min: 0, max: 0.25, step: 'any', value: '0.03', required: true });
    const budget = h('input', { type: 'number', name: 'trial_budget', min: 2, max: 8, value: '4', required: true });
    return h('form', { className: 'spec', onSubmit: event => {
      event.preventDefault();
      // Capture values before perform renders a busy state.
      const payload = { objective: objective.value, target_fraction: Number(target.value),
        tolerance: Number(tolerance.value), trial_budget: Number(budget.value) };
      perform(async () => {
        setExperiment(await bridge.post('/api/experiments', payload));
        catalog = await bridge.get('/api/experiments'); newDraft();
      });
    } }, h('h2', {}, 'New experiment'),
      h('p', { className: 'muted' }, 'Color mixing · fixed 96-well deck · target B1'),
      h('label', {}, 'Objective', objective),
      h('div', { className: 'fields' }, h('label', {}, 'Target fraction', target),
        h('label', {}, 'Tolerance', tolerance), h('label', {}, 'Trial budget', budget)),
      h('p', { className: 'muted' }, 'Inputs and checks are frozen when you create the experiment.'),
      h('button', { type: 'submit', className: 'primary', disabled: busy }, 'Freeze experiment'));
  }
  function deckView() {
    const current = trial(), state = current?.final_state ?? experiment.initial_state;
    const cells = [h('span', { 'aria-hidden': true })];
    for (let col = 1; col <= 12; col++) cells.push(h('span', { className: 'axis', 'aria-hidden': true }, col));
    for (const row of 'ABCDEFGH') {
      cells.push(h('span', { className: 'axis', 'aria-hidden': true }, row));
      for (let col = 1; col <= 12; col++) {
        const id = `${row}${col}`, content = state.wells[id];
        const cell = h('button', { type: 'button', className: `well ${id === well ? 'selected' : ''}`,
          'aria-label': `${id}: ${rounded(content.volume_ul)} microliters`, 'aria-pressed': id === well,
          onClick: () => { well = id; render(); } },
          h('span', { className: 'well-dot', style: `--fill:${Math.min(1, content.volume_ul / 300)}` }),
          h('small', {}, rounded(content.volume_ul)));
        cells.push(cell);
      }
    }
    const value = state.wells[well];
    return h('section', {}, h('div', { className: 'section-heading' }, h('h2', {}, 'Plate'),
        h('span', { className: 'muted' }, `${current ? 'Recorded' : 'Initial'} state · µL`)),
      h('div', { className: 'deck-layout' }, h('div', { className: 'plate', 'aria-label': '96-well plate' }, cells),
        h('aside', { className: 'well-detail' }, h('h3', {}, well),
          h('dl', {}, h('dt', {}, 'Volume'), h('dd', {}, `${rounded(value.volume_ul)} µL`),
            h('dt', {}, 'Predicted dye fraction'), h('dd', {}, rounded(value.volume_ul ? value.dye_ul / value.volume_ul : null)),
            h('dt', {}, 'Channel'), h('dd', {}, state.tip ? `Tip ${state.tip}` : 'Empty'),
            h('dt', {}, 'Pipette'), h('dd', {}, `${rounded(state.pipette.volume_ul)} µL`),
            h('dt', {}, 'Fresh tips'), h('dd', {}, 96 - state.used_tips.length)))),
      h('p', { className: 'muted' }, 'A1: virtual dye · A2: water. Every trial starts from the frozen deck.'),
      !current && button('Add candidate', () => newDraft(), false, true));
  }
  function protocolView() {
    const current = trial();
    if (draft) {
      const steps = h('textarea', { className: 'protocol-editor', 'aria-label': 'Protocol JSON',
        value: draft.steps, spellcheck: false, onInput: event => { draft.steps = event.target.value; } });
      const reason = h('input', { required: true, maxLength: 500, 'aria-label': 'Candidate rationale',
        value: draft.reason, onInput: event => { draft.reason = event.target.value; } });
      return h('section', {}, h('h2', {}, draft.parent_id ? 'Revise candidate' : 'New candidate'),
        h('p', { className: 'muted' }, 'Allowed: pick_up_tip, aspirate, dispense, return_tip. Volumes in µL.'),
        h('form', { onSubmit: event => { event.preventDefault(); perform(async () => {
          const payload = { steps: JSON.parse(draft.steps), parent_id: draft.parent_id,
            reason: draft.reason, input_hash: experiment.input_hash };
          await act('propose', payload); draft = null;
        }); } }, steps, h('label', {}, 'Rationale', reason),
          h('div', { className: 'actions' }, h('button', { type: 'submit', className: 'primary', disabled: busy }, 'Save candidate'),
            button('Cancel edit', () => { draft = null; render(); }))));
    }
    if (!current) return h('section', {}, h('h2', {}, 'No candidate'), button('Add candidate', () => newDraft(), false, true));
    return h('section', {}, h('div', { className: 'section-heading' }, h('h2', {}, 'Protocol'), badge(current.status)),
      h('p', {}, current.reason),
      h('table', {}, h('thead', {}, h('tr', {}, ['Step', 'Action', 'Resource', 'µL'].map(x => h('th', {}, x)))),
        h('tbody', {}, current.steps.map((step, i) => h('tr', { className: current.validation?.step === i + 1 ? 'invalid' : '' },
          h('td', {}, i + 1), h('td', {}, step.action.replaceAll('_', ' ')), h('td', {}, step.resource || '—'),
          h('td', {}, rounded(step.volume_ul)))))),
      current.validation?.error && h('p', { role: 'alert' }, `Step ${current.validation.step ?? '—'}: ${current.validation.error}`),
      current.validation?.status === 'PASS' && h('p', { className: 'muted' }, 'Protocol checks passed. This is not physical safety validation.'),
      h('div', { className: 'actions' },
        button('Validate', () => perform(() => act('validate')), !['proposed', 'validated'].includes(current.status)),
        button('Run simulation', () => perform(() => act('simulate')), running() || !catalog.capability.available || !['proposed', 'validated'].includes(current.status), true),
        button('Revise', () => newDraft(current), running() || experiment.trials.length >= experiment.policy.trial_budget)));
  }
  function runsView() {
    const current = trial();
    return h('section', {}, h('h2', {}, 'Runs'),
      experiment.trials.length === 0 ? h('p', {}, 'Save a candidate to start a run.') :
      h('table', {}, h('thead', {}, h('tr', {}, ['Trial', 'Execution', 'Verification', 'Source'].map(x => h('th', {}, x)))),
        h('tbody', {}, experiment.trials.map((item, i) => h('tr', { className: item.id === selected ? 'active-row' : '' },
          h('td', {}, button(`Trial ${i + 1}`, () => { selected = item.id; draft = null; render(); })),
          h('td', {}, item.status), h('td', {}, item.verification?.status ?? 'Not evaluated'),
          h('td', {}, item.observation?.origin ?? '—'))))),
      current && h('div', {}, h('div', { className: 'section-heading' }, h('h3', {}, 'Step evidence'),
        current.status === 'running' && button('Cancel run', () => perform(() => act('cancel')))),
        current.error && h('p', { role: 'alert' }, current.error),
        h('ol', { className: 'timeline' }, current.steps.map((step, i) => {
          const confirmed = current.events.find(event => event.step === i + 1 && event.status === 'confirmed');
          const started = current.events.some(event => event.step === i + 1 && event.status === 'started');
          return h('li', {}, h('span', {}, `${step.action.replaceAll('_', ' ')} ${step.resource ?? ''}`),
            badge(confirmed ? 'Confirmed' : started ? 'Outcome unknown' : 'Not executed'),
            confirmed && h('details', {}, h('summary', {}, 'State snapshot'), h('pre', {}, JSON.stringify(confirmed, null, 2))));
        })), h('p', { className: 'muted' }, 'Opening a saved run never executes it again.')));
  }
  async function upload(file) {
    if (!file) return;
    if (file.size > 256 * 1024) throw new Error('Measurement files are limited to 256 KiB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    setExperiment(await bridge.post('/api/observations', { experiment_id: experiment.id,
      trial_id: selected, filename: file.name, content_base64: btoa(binary) }));
  }
  function resultsView() {
    const current = trial();
    if (!current) return h('section', {}, h('h2', {}, 'No results'), h('p', {}, 'Run a candidate first.'));
    const result = current.verification;
    const parent = experiment.trials.find(item => item.id === current.parent_id);
    const delta = comparableDelta(current, parent);
    const file = h('input', { type: 'file', accept: '.csv,.json', 'aria-label': 'Measurement file',
      disabled: busy || current.status !== 'completed' || !!current.observation,
      onChange: event => { const chosen = event.target.files?.[0]; perform(() => upload(chosen)); } });
    const reviewNote = h('input', { 'aria-label': 'Review note', placeholder: 'Reason for this decision', maxLength: 500 });
    const review = decision => {
      const note = reviewNote.value;
      perform(async () => setExperiment(await bridge.post('/api/review', {
        experiment_id: experiment.id, trial_id: selected, decision, note,
      })));
    };
    return h('section', {}, h('div', { className: 'section-heading' }, h('h2', {}, 'Results'),
        badge(current.observation ? `${current.observation.origin} observations` : 'No observations')),
      !current.observation && h('div', {},
        h('div', { className: 'actions' }, button('Use synthetic fixture', () => perform(() => act('synthetic')), current.status !== 'completed'),
          h('label', {}, 'Import measurements', file)),
        h('p', { className: 'muted' }, 'CSV: well,value,unit. JSON: an array of those fields. Unit: fraction; max 256 KiB.')),
      current.observation?.origin === 'synthetic' && h('p', { className: 'notice' }, 'Synthetic fixture: predicted fraction × 0.9. Not an optical or robot measurement.'),
      current.observation && h('details', {}, h('summary', {}, 'Measurement provenance'),
        h('p', {}, current.observation.filename), h('code', {}, `SHA256 ${current.observation.sha256}`)),
      button('Evaluate', () => perform(() => act('evaluate')), current.status === 'running', true),
      result && h('div', {}, h('div', { className: 'metric-row' },
        h('div', {}, h('small', {}, 'Target'), h('strong', {}, rounded(experiment.policy.target_fraction))),
        h('div', {}, h('small', {}, 'Predicted'), h('strong', {}, rounded(result.predicted_fraction))),
        h('div', {}, h('small', {}, 'Observed'), h('strong', {}, rounded(result.observed_fraction))),
        h('div', {}, h('small', {}, 'Absolute error'), h('strong', {}, rounded(result.absolute_error)))),
        h('h3', {}, 'Verification ', badge(result.status, result.status)),
        h('ul', { className: 'checks' }, result.checks.map(check => h('li', {},
          h('span', {}, check.name), badge(check.status, check.status), h('small', {}, check.detail)))),
        parent && h('p', {}, delta == null ? 'No comparable observation pair.' : `Error Δ vs parent: ${rounded(delta)} fraction. ${delta < 0 ? 'Lower error.' : delta > 0 ? 'Higher error.' : 'No improvement.'}`),
        h('p', { className: 'muted' }, result.acceptance)),
      h('details', {}, h('summary', {}, 'Review decision'),
        h('p', { className: 'muted' }, 'A separate review of this software experiment, not scientific or physical safety approval.'),
        reviewNote, h('div', { className: 'actions' }, button('Accept result', () => review('accepted'), result?.status !== 'PASS'),
          button('Reject result', () => review('rejected'), current.status === 'running')),
        current.reviews.map(item => h('p', {}, `${item.decision}: ${item.note}`))),
      h('div', { className: 'actions' }, button('Revise from this trial', () => newDraft(current),
        running() || experiment.trials.length >= experiment.policy.trial_budget)));
  }
  function render() {
    if (disposed) return;
    const header = h('header', {}, h('div', {}, h('h1', {}, 'Lab'),
      h('span', { className: 'muted' }, 'Color mixing')),
      h('div', { className: 'actions' }, badge('Simulation only'),
        button('New experiment', () => { creating = true; draft = null; render(); }, running()),
        button('Ask Agent', ask, !experiment), button('Export', exportRecord, !experiment)));
    const sidebar = h('aside', { className: 'experiments' }, h('h2', {}, 'Experiments'),
      catalog.experiments.map(item => button(item.objective, () => select(item.id))));
    let body;
    if (loading) body = h('p', { role: 'status' }, 'Loading experiments…');
    else if (creating) body = specForm();
    else if (!experiment) body = h('section', { className: 'empty' }, h('h2', {}, 'Design your first experiment'),
      button('New experiment', () => { creating = true; render(); }, false, true));
    else body = h('div', {}, h('div', { className: 'section-heading' }, h('div', {}, h('h2', {}, experiment.policy.objective),
      h('p', { className: 'muted' }, `Target ${experiment.policy.target_fraction} ± ${experiment.policy.tolerance} fraction · ${experiment.trials.length}/${experiment.policy.trial_budget} candidates`)),
      experiment.trials.length > 0 && h('select', { 'aria-label': 'Selected trial', onChange: event => { selected = event.target.value; draft = null; render(); } },
        experiment.trials.map((item, i) => h('option', { value: item.id, selected: item.id === selected }, `Trial ${i + 1} · ${item.status}`)))),
      h('nav', { 'aria-label': 'Experiment views' }, ['Deck', 'Protocol', 'Runs', 'Results'].map(name =>
        button(name, () => { tab = name; render(); }, false, name === tab))),
      tab === 'Deck' ? deckView() : tab === 'Protocol' ? protocolView() : tab === 'Runs' ? runsView() : resultsView());
    const content = [header,
      error && h('div', { className: 'error', role: 'alert' }, error, button('Retry', refresh)),
      !loading && !catalog.capability.available && h('div', { className: 'notice', role: 'status' },
        `PyLabRobot unavailable: ${catalog.capability.error ?? 'Prepare the App Python environment.'}`),
      h('div', { className: 'workspace' }, sidebar, h('main', {}, body)),
      h('footer', {}, catalog.capability.available ? `${catalog.capability.engine} ${catalog.capability.version ?? ''} · ${catalog.capability.backend ?? ''} · No hardware access` : 'Simulation engine unavailable')];
    root.replaceChildren(...content.filter(child => child !== false && child !== null && child !== undefined && child !== ''));
  }
  refresh();
  return { refresh, destroy() { disposed = true; ++epoch; clearTimeout(timer); root.replaceChildren(); } };
}
