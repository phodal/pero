// Workflow helper behavior follows the pinned DSH reference in SOURCE.json.
// This VM isolates JavaScript globals; it is not an operating-system sandbox.
const vm = require('node:vm');
const readline = require('node:readline');
const input = readline.createInterface({ input: process.stdin, terminal: false });
const pending = new Map();
let nextID = 0;
let initialized = false;
let agentCount = 0;
let maxItems = 1024;
class Fatal extends Error {}
function send(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
function contain(promise) { promise.catch(() => {}); return promise; }
function rpc(method, value) {
  const id = ++nextID;
  return contain(new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ id, method, ...value });
  }));
}
function jsonValue(value, label) {
  const ancestors = new Set();
  function visit(item, depth) {
    if (depth > 64) throw new Fatal(label + ' exceeds the JSON depth limit');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || ancestors.has(item)) throw new Fatal(label + ' must be lossless JSON data');
    ancestors.add(item);
    if (Array.isArray(item)) {
      for (const key of Reflect.ownKeys(item)) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length) throw new Fatal(label + ' must not contain extra array properties');
      }
      for (let index = 0; index < item.length; index++) {
        const property = Object.getOwnPropertyDescriptor(item, index);
        if (!property || !Object.hasOwn(property, 'value')) throw new Fatal(label + ' must not contain sparse arrays or accessors');
        visit(property.value, depth + 1);
      }
    } else {
      if (Object.prototype.toString.call(item) !== '[object Object]') throw new Fatal(label + ' must contain plain objects');
      for (const key of Reflect.ownKeys(item)) {
        const property = Object.getOwnPropertyDescriptor(item, key);
        if (typeof key !== 'string' || !property || !Object.hasOwn(property, 'value')) throw new Fatal(label + ' must not contain accessors or symbols');
        visit(property.value, depth + 1);
      }
    }
    ancestors.delete(item);
  }
  visit(value, 0);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > 1024 * 1024) throw new Fatal(label + ' exceeds the 1 MiB JSON limit');
  return JSON.parse(encoded);
}
function object(value, label, fields) {
  const result = jsonValue(value, label);
  if (result === null || typeof result !== 'object' || Array.isArray(result)) throw new Fatal(label + ' must be an object');
  for (const key of Object.keys(result)) if (!fields.includes(key)) throw new Fatal(label + ' has an unsupported field: ' + key);
  return result;
}
function text(value, label, empty = false) {
  if (typeof value !== 'string' || (!empty && value.trim() === '')) throw new Fatal(label + ' must be a string' + (empty ? '' : ' with content'));
  return value;
}
function metadata(value) {
  const valueObject = object(value, 'meta', ['name', 'description', 'whenToUse', 'phases']);
  const result = { name: text(valueObject.name, 'meta.name'), description: text(valueObject.description, 'meta.description') };
  if (valueObject.whenToUse !== undefined) {
    const when = text(valueObject.whenToUse, 'meta.whenToUse', true);
    if (when) result.whenToUse = when;
  }
  if (valueObject.phases !== undefined) {
    if (!Array.isArray(valueObject.phases)) throw new Fatal('meta.phases must be an array');
    const phases = valueObject.phases.map(value => {
      const phase = object(value, 'meta phase', ['title', 'detail', 'provider', 'model']);
      const result = { title: text(phase.title, 'phase.title') };
      for (const key of ['detail', 'provider', 'model']) {
        if (phase[key] !== undefined && text(phase[key], 'phase.' + key, true)) result[key] = phase[key];
      }
      return result;
    });
    if (phases.length) result.phases = phases;
  }
  return result;
}
function script(source, path) {
  let start = source.charCodeAt(0) === 0xFEFF ? 1 : 0;
  for (;;) {
    while (/\s/.test(source[start] || '') && start < source.length) start++;
    if (source.slice(start, start + 2) === '//') { const end = source.indexOf('\n', start); start = end < 0 ? source.length : end + 1; continue; }
    if (source.slice(start, start + 2) === '/*') { const end = source.indexOf('*/', start + 2); if (end < 0) throw new Fatal('unclosed script comment'); start = end + 2; continue; }
    break;
  }
  const prefix = /^export\s+const\s+meta\s*=\s*/.exec(source.slice(start));
  if (!prefix) throw new Fatal('selected workflow must begin with export const meta = { ... }');
  const begin = start + prefix[0].length;
  if (source[begin] !== '{') throw new Fatal('workflow meta must be an object literal');
  let depth = 0, quote = '', escaped = false, comment = '';
  let end = begin;
  for (; end < source.length; end++) {
    const char = source[end], next = source[end + 1];
    if (comment === '//') { if (char === '\n') comment = ''; continue; }
    if (comment === '/*') { if (char === '*' && next === '/') { comment = ''; end++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && (next === '/' || next === '*')) { comment = '/' + next; end++; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) { end++; break; }
  }
  if (depth !== 0) throw new Fatal('workflow meta object is not closed');
  const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  const meta = metadata(new vm.Script('(' + source.slice(begin, end) + ')', { filename: path }).runInContext(context, { timeout: 100 }));
  return { meta, body: source.slice(end).replace(/^\s*;/, '') };
}
async function evaluate(path, args, declaredMeta, depth = 0) {
  if (depth > 16) throw new Fatal('nested workflow depth exceeds 16');
  const loaded = await rpc('load', { scriptPath: path });
  const { meta, body } = script(loaded.source, path);
  if (declaredMeta && JSON.stringify(metadata(declaredMeta)) !== JSON.stringify(meta)) throw new Fatal('supplied meta differs from the selected script export');
  send({ method: 'meta', scriptPath: path, meta });
  let currentPhase;
  function agent(prompt, supplied = {}) {
    text(prompt, 'agent prompt');
    const options = object(supplied, 'agent options', ['label', 'phase', 'provider', 'model', 'schema']);
    for (const key of ['label', 'phase', 'provider', 'model']) if (options[key] !== undefined) text(options[key], 'agent option ' + key, true);
    if (options.schema !== undefined && (options.schema === null || typeof options.schema !== 'object' || Array.isArray(options.schema))) throw new Fatal('agent schema must be an object JSON schema');
    agentCount++;
    const phase = options.phase === undefined ? currentPhase : options.phase;
    const defaults = (meta.phases || []).find(item => item.title === phase) || {};
    return contain(rpc('agent', {
      scriptPath: path, prompt,
      label: options.label || prompt.split('\n')[0].slice(0, 48),
      ...(phase === undefined ? {} : { phase }),
      ...(options.provider || defaults.provider ? { provider: options.provider || defaults.provider } : {}),
      ...(options.model || defaults.model ? { model: options.model || defaults.model } : {}),
      ...(options.schema === undefined ? {} : { schema: options.schema }),
    }).then(result => {
      if (result.status !== 'completed') return null;
      return options.schema === undefined ? (result.text || '') : (result.structured === undefined ? null : result.structured);
    }));
  }
  function items(values, label) {
    if (!Array.isArray(values) || values.length > maxItems) throw new Fatal(label + ' requires an array with at most ' + maxItems + ' items');
    return values;
  }
  function parallel(thunks) {
    items(thunks, 'parallel');
    if (thunks.some(thunk => typeof thunk !== 'function')) throw new Fatal('parallel items must be functions');
    return contain(Promise.all(thunks.map(async thunk => {
      try { return await thunk(); } catch (error) { if (error instanceof Fatal) throw error; return null; }
    })));
  }
  function pipeline(values, ...stages) {
    items(values, 'pipeline');
    if (stages.length === 0 || stages.some(stage => typeof stage !== 'function')) throw new Fatal('pipeline requires stage functions');
    return contain(Promise.all(values.map(async (original, index) => {
      let value = original;
      try { for (const stage of stages) value = await stage(value, original, index); return value; }
      catch (error) { if (error instanceof Fatal) throw error; return null; }
    })));
  }
  function workflow(request, nestedArgs) {
    const call = object(request, 'nested workflow', ['scriptPath', 'meta']);
    text(call.scriptPath, 'nested scriptPath');
    return contain(evaluate(call.scriptPath, nestedArgs === undefined ? undefined : jsonValue(nestedArgs, 'nested args'), call.meta, depth + 1));
  }
  const context = vm.createContext({
    args, meta, agent, parallel, pipeline, workflow,
    phase(title) { currentPhase = text(title, 'phase'); send({ method: 'phase', scriptPath: path, message: title }); },
    log(message) { send({ method: 'log', scriptPath: path, message: text(message, 'log', true) }); },
  }, { name: 'selected-workflow', codeGeneration: { strings: false, wasm: false } });
  const result = await new vm.Script('(async () => {\n' + body + '\n})()', { filename: path, lineOffset: -1 }).runInContext(context, { timeout: 1000 });
  return result === undefined ? null : jsonValue(result, 'workflow result');
}
input.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { process.exit(2); }
  if (!initialized) {
    initialized = true;
    maxItems = message.maxItems;
    contain(evaluate(message.scriptPath, message.args, message.meta).then(value => {
      send({ method: 'done', result: { value, stopReason: 'completed', agentCalls: agentCount } });
    }, error => {
      send({ method: 'done', result: { value: null, stopReason: 'error', error: String(error && error.message || error), agentCalls: agentCount } });
    }));
    return;
  }
  const waiting = pending.get(message.id);
  if (!waiting) return;
  pending.delete(message.id);
  if (message.error) waiting.reject(new Fatal(message.error));
  else waiting.resolve(message);
});
