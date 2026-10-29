export type AppJson = null | boolean | number | string | AppJson[] | { [key: string]: AppJson };
export type AppObjectAction = {
  description?: string;
  parameters?: Record<string, unknown>;
  run(params: Record<string, unknown>): unknown | Promise<unknown>;
};
export type AppObject = {
  id: string;
  kind: string;
  label: string;
  state: unknown;
  actions?: Record<string, AppObjectAction>;
};
export type AppObjectSnapshot = {
  id: string;
  kind: string;
  label: string;
  state: AppJson;
  revision: number;
  commands: Array<{ name: string; description?: string; parameters: Record<string, unknown> }>;
};
export type AppUseRevisions = { semantic: number; objects: Record<string, number>; snapshot: number };
export type AppUseRequest = {
  action: 'observe' | 'semantic' | 'invoke' | 'verify' | 'dom.click' | 'dom.fill' | 'geometry' | 'annotation';
  target?: string;
  name?: string;
  params?: Record<string, unknown>;
  revision?: number;
  expectedRevisions?: AppUseRevisions;
  key?: string;
  equals?: unknown;
};

export class AppUseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'AppUseError'; this.code = code; }
}

const objectId = /^[A-Za-z0-9][\w.:-]{0,127}$/;
const actionName = /^[A-Za-z][\w.-]{0,63}$/;
const encoder = new TextEncoder();

function copyJson(value: unknown, bytes: number): AppJson {
  let serialized: string;
  try {
    serialized = JSON.stringify(value ?? null, (_key, part) => {
      if (typeof part === 'number' && !Number.isFinite(part) || ['undefined', 'function', 'symbol', 'bigint'].includes(typeof part))
        throw new Error('Only JSON values are supported');
      return part;
    });
  } catch { throw new AppUseError('APP_OBJECT_INVALID', 'App values must be finite JSON without cycles'); }
  if (encoder.encode(serialized).length > bytes) throw new AppUseError('APP_OBJECT_INVALID', `App value exceeds ${bytes} bytes`);
  return JSON.parse(serialized) as AppJson;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a), right = Object.keys(b);
  return left.length === right.length && left.every(key => Object.hasOwn(b, key) && equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

type ParameterRule = { enumeration?: AppJson[] } & (
  | { kind: 'object'; properties: Map<string, ParameterRule>; required: Set<string>; additional: boolean }
  | { kind: 'array'; item: ParameterRule; min: number; max: number }
  | { kind: 'number' | 'integer'; min: number; max: number }
  | { kind: 'string'; min: number; max: number; file?:boolean }
  | { kind: 'boolean' | 'null' | 'enum' }
  | { kind: 'anyOf'; choices: ParameterRule[] }
);

/** A bounded JSON Schema subset interpreted as values, compatible with script-src self. */
export class AppParameterSchema {
  private readonly rule: ParameterRule;
  private constructor(rule: ParameterRule) { this.rule = rule; }

  static parse(schema: unknown) {
    let nodes = 0;
    const invalid = (message: string): never => { throw new AppUseError('APP_OBJECT_INVALID', `Invalid App parameter schema: ${message}`); };
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) invalid('action parameters must be a schema object');
    if ((schema as Record<string, unknown>).type !== 'object') invalid('action parameters must declare type: object');
    const parse = (input: unknown, depth: number): ParameterRule => {
      if (++nodes > 1000 || depth > 12) invalid('schema exceeds 1000 nodes or 12 levels');
      if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('each rule must be an object');
      const value = input as Record<string, unknown>;
      const kind = value.anyOf !== undefined ? 'anyOf' : value.type ?? (value.enum !== undefined ? 'enum' : undefined);
      const specific = kind === 'object' ? ['properties', 'required', 'additionalProperties'] : kind === 'array' ? ['items', 'minItems', 'maxItems']
        : kind === 'number' || kind === 'integer' ? ['minimum', 'maximum'] : kind === 'string' ? ['minLength', 'maxLength','format'] : kind === 'anyOf' ? ['anyOf'] : [];
      const allowed = new Set(['type', 'enum', 'description', 'title', ...specific]);
      for (const key of Object.keys(value)) if (!allowed.has(key)) invalid(`unsupported keyword ${key}`);
      for (const key of ['description', 'title']) if (value[key] !== undefined && typeof value[key] !== 'string') invalid(`${key} must be a string`);
      let enumeration: AppJson[] | undefined;
      if (value.enum !== undefined) {
        if (!Array.isArray(value.enum) || value.enum.length < 1 || value.enum.length > 100) invalid('enum needs 1–100 JSON values');
        enumeration = value.enum as AppJson[];
      }
      const bounds = (low: string, high: string, maximum: number, integral: boolean): [number, number] => {
        const min = value[low] ?? (integral ? 0 : -Infinity), max = value[high] ?? maximum;
        if (typeof min !== 'number' || typeof max !== 'number' || value[low] !== undefined && !Number.isFinite(min) || value[high] !== undefined && !Number.isFinite(max)
          || min > max || integral && (!Number.isSafeInteger(min) || min < 0 || !Number.isSafeInteger(max) || max > maximum)) invalid(`invalid ${low}/${high} bounds`);
        return [min as number, max as number];
      };
      if (kind === 'object') {
        const source = value.properties ?? {};
        if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).length > 100) invalid('properties must contain at most 100 named rules');
        const properties = new Map(Object.entries(source).map(([key, rule]) => [key, parse(rule, depth + 1)]));
        const required = value.required ?? [];
        if (!Array.isArray(required) || required.some(key => typeof key !== 'string' || !properties.has(key)) || new Set(required).size !== required.length) invalid('required must name unique declared properties');
        if (value.additionalProperties !== undefined && typeof value.additionalProperties !== 'boolean') invalid('additionalProperties must be boolean');
        return { kind, properties, required: new Set(required as string[]), additional: value.additionalProperties !== false, enumeration };
      }
      if (kind === 'array') {
        const [min, max] = bounds('minItems', 'maxItems', 1000, true);
        return { kind, item: parse(value.items, depth + 1), min, max, enumeration };
      }
      if (kind === 'string') {
        const [min, max] = bounds('minLength', 'maxLength', 65536, true);
        if(value.format!==undefined&&value.format!=='pero-file-ref')invalid('unsupported file format');
        return { kind, min, max, enumeration,file:value.format==='pero-file-ref' };
      }
      if (kind === 'number' || kind === 'integer') {
        const [min, max] = bounds('minimum', 'maximum', Infinity, false);
        return { kind, min, max, enumeration };
      }
      if (kind === 'anyOf') {
        if (value.type !== undefined) invalid('anyOf cannot be combined with type in this subset');
        if(JSON.stringify(value.anyOf).includes('pero-file-ref'))invalid('file references require an unambiguous schema');
        if (!Array.isArray(value.anyOf) || value.anyOf.length < 1 || value.anyOf.length > 8) invalid('anyOf needs 1–8 rules');
        return { kind, choices: (value.anyOf as unknown[]).map(rule => parse(rule, depth + 1)), enumeration };
      }
      if (kind === 'boolean' || kind === 'null' || kind === 'enum') return { kind, enumeration };
      return invalid('type must be object, array, string, number, integer, boolean or null');
    };
    return new AppParameterSchema(parse(schema, 0));
  }

  async resolveFiles(value:AppJson,issue:(reference:string)=>Promise<string>):Promise<AppJson>{
    const visit=async(rule:ParameterRule,input:AppJson):Promise<AppJson>=>{
      if(rule.kind==='string'&&rule.file){if(typeof input!=='string')throw new AppUseError('APP_PARAMS_INVALID','File input must be a reference');return issue(input);}
      if(rule.kind==='object'&&input&&typeof input==='object'&&!Array.isArray(input)){
        const result:Record<string,AppJson>={};
        for(const [key,item]of Object.entries(input)){const child=rule.properties.get(key);Object.defineProperty(result,key,{value:child?await visit(child,item):item,enumerable:true});}
        return result;
      }
      if(rule.kind==='array'&&Array.isArray(input)){const result:AppJson[]=[];for(const item of input)result.push(await visit(rule.item,item));return result;}
      return input;
    };
    return visit(this.rule,value);
  }
  validate(value: AppJson) {
    const check = (rule: ParameterRule, input: AppJson, path: string): string | undefined => {
      if (rule.enumeration && !rule.enumeration.some(option => equal(input, option))) return `${path} is not an allowed enum value`;
      if (rule.kind === 'enum') return;
      if (rule.kind === 'anyOf') return rule.choices.some(choice => check(choice, input, path) === undefined) ? undefined : `${path} matches no anyOf rule`;
      if (rule.kind === 'object') {
        if (!input || typeof input !== 'object' || Array.isArray(input)) return `${path} must be an object`;
        for (const key of rule.required) if (!Object.hasOwn(input, key)) return `${path}.${key} is required`;
        for (const [key, field] of Object.entries(input)) {
          const child = rule.properties.get(key);
          if (!child && !rule.additional) return `${path}.${key} is not declared`;
          if (child) { const error = check(child, field, `${path}.${key}`); if (error) return error; }
        }
      } else if (rule.kind === 'array') {
        if (!Array.isArray(input) || input.length < rule.min || input.length > rule.max) return `${path} must be an array of ${rule.min}–${rule.max} items`;
        for (let index = 0; index < input.length; ++index) { const error = check(rule.item, input[index], `${path}[${index}]`); if (error) return error; }
      } else if (rule.kind === 'string') {
        if (typeof input !== 'string' || [...input].length < rule.min || [...input].length > rule.max) return `${path} must be a string of ${rule.min}–${rule.max} characters`;
      } else if (rule.kind === 'number' || rule.kind === 'integer') {
        if (typeof input !== 'number' || !Number.isFinite(input) || rule.kind === 'integer' && !Number.isInteger(input) || input < rule.min || input > rule.max) return `${path} must be a ${rule.kind} in range`;
      } else if (rule.kind === 'null' ? input !== null : typeof input !== 'boolean') return `${path} must be ${rule.kind}`;
      return;
    };
    const error = check(this.rule, value, 'params');
    if (error) throw new AppUseError('APP_PARAMS_INVALID', error);
  }
}

type RegisteredObject = {
  snapshot: Omit<AppObjectSnapshot, 'revision'>;
  revision: number;
  actions: Map<string, { run: AppObjectAction['run']; parameters: AppParameterSchema }>;
};

/** An App declares its existing UI state and actions; no second model is maintained. */
export class AppSurface {
  private readonly objects = new Map<string, RegisteredObject>();
  private revision = 0;

  register(object: AppObject) {
    if (this.objects.has(object.id)) throw new AppUseError('APP_OBJECT_DUPLICATE', `App object ${object.id} is already registered`);
    if (this.objects.size >= 100) throw new AppUseError('APP_OBJECT_LIMIT', 'An App may expose at most 100 objects');
    const entry = this.normalize(object);
    entry.revision = ++this.revision;
    this.objects.set(object.id, entry);
    let live = true;
    return {
      update: (next: AppObject) => {
        if (!live) return;
        if (next.id !== object.id) throw new AppUseError('APP_OBJECT_INVALID', 'An App object cannot change its identity');
        const replacement = this.normalize(next);
        entry.actions = replacement.actions;
        if (!equal(entry.snapshot, replacement.snapshot)) {
          entry.snapshot = replacement.snapshot;
          entry.revision = ++this.revision;
        }
      },
      dispose: () => {
        if (!live) return;
        live = false;
        this.objects.delete(object.id);
        ++this.revision;
      },
    };
  }

  observe(target?: string): { revision: number; objects: AppObjectSnapshot[] } {
    if (target !== undefined && !this.objects.has(target)) throw new AppUseError('APP_OBJECT_UNKNOWN', `Unknown App object ${target}`);
    return {
      revision: this.revision,
      objects: [...this.objects.values()].filter(entry => target === undefined || entry.snapshot.id === target)
        .map(entry => ({ ...copyJson(entry.snapshot, 131072) as unknown as Omit<AppObjectSnapshot, 'revision'>, revision: entry.revision })),
    };
  }

  async invoke(target: string, name: string, params: Record<string, unknown>, revision: number) {
    const entry = this.objects.get(target);
    if (!entry) throw new AppUseError('APP_OBJECT_UNKNOWN', `Unknown App object ${target}`);
    if (entry.revision !== revision) throw new AppUseError('APP_REVISION_STALE', 'The App object changed; observe it again before invoking an action');
    const action = entry.actions.get(name);
    if (!action) throw new AppUseError('APP_ACTION_UNKNOWN', `Unknown App action ${target}.${name}`);
    const input = copyJson(params, 65536);
    action.parameters.validate(input);
    const result = await action.run(input as Record<string, AppJson>);
    return { verdict: 'not-run' as const, result: copyJson(result, 32768) };
  }

  verify(target: string, key: string, expected: unknown) {
    const object = this.observe(target).objects[0];
    const found = object.state !== null && typeof object.state === 'object' && !Array.isArray(object.state) && Object.hasOwn(object.state, key);
    const actual = found ? (object.state as Record<string, AppJson>)[key] : null;
    return { verdict: found && equal(actual, expected) ? 'pass' as const : 'fail' as const, actual, found };
  }

  /** An App can report a rendered frame that changed outside its JSON state. */
  signal(target: string) {
    const entry = this.objects.get(target);
    if (!entry) throw new AppUseError('APP_OBJECT_UNKNOWN', `Unknown App object ${target}`);
    entry.revision = ++this.revision;
    return entry.revision;
  }

  private normalize(object: AppObject): RegisteredObject {
    if (typeof object.id !== 'string' || !objectId.test(object.id) || typeof object.kind !== 'string' || !object.kind || object.kind.length > 64 || typeof object.label !== 'string' || object.label.length > 300)
      throw new AppUseError('APP_OBJECT_INVALID', 'An App object needs an id, kind and label within their limits');
    const entries = Object.entries(object.actions ?? {}).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length > 32) throw new AppUseError('APP_OBJECT_INVALID', 'An App object may expose at most 32 actions');
    const actions: RegisteredObject['actions'] = new Map();
    const commands = entries.map(([name, action]) => {
      if (!actionName.test(name) || typeof action.run !== 'function' || action.description !== undefined && (typeof action.description !== 'string' || action.description.length > 500))
        throw new AppUseError('APP_OBJECT_INVALID', 'App actions need a valid name, description and run function');
      const parameters = copyJson(action.parameters === undefined ? { type: 'object', properties: {}, additionalProperties: false } : action.parameters, 8192) as Record<string, unknown>;
      actions.set(name, { run: action.run, parameters: AppParameterSchema.parse(parameters) });
      return { name, ...(action.description === undefined ? {} : { description: action.description }), parameters };
    });
    return { snapshot: { id: object.id, kind: object.kind, label: object.label, state: copyJson(object.state, 32768), commands }, revision: 0, actions };
  }
}

/** One registry per App document, independent of React and Desktop initialization. */
export const appSurface = new AppSurface();

export function installAppUseBridge(surface = appSurface, frame: Window = window) {
  const dom = new AppUseDom(surface, frame.document);
  let parentOrigin = '*';
  let reportedAt = -Infinity;
  const humanInput = (event: Event) => {
    if (!event.isTrusted || Date.now() - reportedAt < 1000) return;
    reportedAt = Date.now();
    frame.parent.postMessage({ type: 'pero:app-use:human-input' }, parentOrigin);
  };
  const receive = async (event: MessageEvent) => {
    if (event.source !== frame.parent) return;
    parentOrigin = event.origin === 'null' ? '*' : event.origin;
    if (event.data?.type !== 'pero:app-use:request') return;
    const id = event.data.id;
    if (typeof id !== 'string' || !id || id.length > 128) return;
    let reply: object;
    try {
      const request = event.data.request as AppUseRequest;
      if (!request || typeof request !== 'object' || !['observe', 'semantic', 'invoke', 'verify', 'dom.click', 'dom.fill', 'geometry', 'annotation'].includes(request.action))
        throw new AppUseError('APP_USE_INVALID', 'Unknown App Use request');
      if (request.target !== undefined && (typeof request.target !== 'string' || request.target.length > 128))
        throw new AppUseError('APP_USE_INVALID', 'Invalid App target');
      let value: unknown;
      if (request.action === 'semantic') value = surface.observe(request.target);
      else if (request.action === 'observe') value = dom.observe(request.target);
      else if (request.action === 'geometry') value = dom.geometry(request.target);
      else if (request.action === 'annotation') value = dom.annotation();
      else if (request.action.startsWith('dom.')) value = dom.act(request);
      else if (request.action === 'verify') {
        if (typeof request.target !== 'string' || typeof request.key !== 'string' || !request.key || request.key.length > 128)
          throw new AppUseError('APP_USE_INVALID', 'Verification needs a target and state key');
        value = surface.verify(request.target, request.key, request.equals);
      } else {
        const revision = request.revision ?? request.expectedRevisions?.objects?.[request.target ?? ''];
        if (typeof request.target !== 'string' || typeof request.name !== 'string' || !Number.isSafeInteger(revision) || request.params !== undefined && (!request.params || typeof request.params !== 'object' || Array.isArray(request.params)))
          throw new AppUseError('APP_USE_INVALID', 'Invocation needs an object, action, parameters and observed revision');
        dom.invalidate();
        value = await surface.invoke(request.target, request.name, request.params ?? {}, revision!);
      }
      reply = { type: 'pero:app-use:result', id, ok: true, value };
    } catch (error) {
      reply = { type: 'pero:app-use:result', id, ok: false, error: { code: error instanceof AppUseError ? error.code : 'APP_ACTION_FAILED', message: error instanceof Error ? error.message : String(error) } };
    }
    frame.parent.postMessage(reply, parentOrigin);
  };
  frame.addEventListener('message', receive);
  for (const type of ['pointerdown', 'keydown']) frame.addEventListener(type, humanInput, true);
  return () => {
    frame.removeEventListener('message', receive);
    for (const type of ['pointerdown', 'keydown']) frame.removeEventListener(type, humanInput, true);
  };
}


const controls = 'button,a[href],input,textarea,select,summary,[contenteditable="true"],[role="button"],[role="checkbox"],[role="switch"],[role="tab"],[role="radio"],[role="menuitem"],[role="option"],[role="slider"],[role="link"]';
const textInputs = new Set(['text', 'search', 'url', 'tel', 'email']);
const clip = (value: unknown, limit: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

function visible(element: Element) {
  return element.isConnected && !element.closest('[hidden],[aria-hidden="true"],[inert]') && element.getClientRects().length > 0;
}

function label(element: Element): string {
  const named = element.getAttribute('aria-label');
  if (named) return clip(named, 300);
  const ids = element.getAttribute('aria-labelledby');
  if (ids) {
    const text = ids.split(/\s+/).map(id => element.ownerDocument.getElementById(id)?.textContent ?? '').join(' ');
    if (text.trim()) return clip(text, 300);
  }
  const inputLabels = 'labels' in element ? [...((element as HTMLInputElement).labels ?? [])].map(node => node.textContent ?? '').join(' ') : '';
  return clip(inputLabels || element.getAttribute('placeholder') || element.getAttribute('title') || element.textContent || element.getAttribute('name'), 300);
}

function role(element: Element): string {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  if (tag === 'summary') return 'button';
  if (tag === 'input') {
    const type = (element as HTMLInputElement).type;
    if (['checkbox', 'radio'].includes(type)) return type;
    if (type === 'range') return 'slider';
    return ['button', 'submit', 'reset'].includes(type) ? 'button' : 'textbox';
  }
  return element.getAttribute('contenteditable') === 'true' ? 'textbox' : tag;
}

function fingerprint(element: Element) {
  return JSON.stringify([element.tagName, role(element), label(element), element.getAttribute('type')]);
}

function describe(element: Element, ref: string) {
  const input = element as HTMLInputElement;
  const type = input.type;
  return {
    ref, tag: element.tagName.toLowerCase(), role: role(element), label: label(element),
    ...(type ? { type } : {}),
    ...('value' in element && typeof input.value === 'string' && element.tagName !== 'BUTTON' ? { value: type === 'password' ? '[redacted]' : clip(input.value, 1000) } : {}),
    ...(['checkbox', 'radio'].includes(type) ? { checked: input.checked } : {}),
    ...(input.disabled || element.getAttribute('aria-disabled') === 'true' ? { disabled: true } : {}),
    ...(input.readOnly ? { readonly: true } : {}),
    ...(element.closest('[data-app-object]')?.getAttribute('data-app-object') ? { object: element.closest('[data-app-object]')!.getAttribute('data-app-object')! } : {}),
  };
}

/** DOM access remains inside the App document. The parent owns approval and frame identity. */
export class AppUseDom {
  private snapshot = 0;
  private readonly refs = new Map<string, { element: Element; fingerprint: string }>();
  private readonly surface: AppSurface;
  private readonly document: Document;
  constructor(surface: AppSurface, document: Document) { this.surface = surface; this.document = document; }

  invalidate() { ++this.snapshot; this.refs.clear(); }

  observe(target?: string) {
    const semantic = this.surface.observe(target);
    this.invalidate();
    const elements = target === undefined ? [...this.document.querySelectorAll(controls)].filter(visible) : [];
    const dom = elements.slice(0, 150).map((element, index) => {
      const ref = `a${this.snapshot}-${index + 1}`;
      this.refs.set(ref, { element, fingerprint: fingerprint(element) });
      return describe(element, ref);
    });
    const text = target === undefined ? this.document.body.innerText : '';
    return {
      ...semantic, dom, text: text.slice(0, 16000), domTruncated: elements.length > 150, textTruncated: text.length > 16000,
      revisions: { semantic: semantic.revision, objects: Object.fromEntries(semantic.objects.map(object => [object.id, object.revision])), snapshot: this.snapshot },
    };
  }

  act(request: AppUseRequest) {
    const target = request.target;
    if (request.expectedRevisions?.snapshot !== this.snapshot || typeof target !== 'string' || !this.refs.has(target))
      throw new AppUseError('APP_REF_STALE', 'Observe the App again and use a ref from its latest observation');
    const held = this.refs.get(target)!;
    const element = held.element as HTMLElement & { disabled?: boolean; readOnly?: boolean };
    if (!visible(element) || !this.document.body.contains(element) || fingerprint(element) !== held.fingerprint)
      throw new AppUseError('APP_REF_STALE', 'The observed App control has been removed or changed');
    if (element.disabled || element.getAttribute('aria-disabled') === 'true') throw new AppUseError('APP_TARGET_DISABLED', 'This App control is disabled');
    if (request.action === 'dom.click') element.click();
    else if (request.action === 'dom.fill') {
      const input = element as HTMLInputElement | HTMLTextAreaElement;
      if (input.readOnly) throw new AppUseError('APP_TARGET_READONLY', 'This App field is read-only');
      if (element.tagName !== 'TEXTAREA' && (element.tagName !== 'INPUT' || !textInputs.has(input.type)))
        throw new AppUseError('APP_TARGET_UNSUPPORTED', 'Only plain-text inputs and textareas can be filled');
      const value = request.params?.value;
      if (typeof value !== 'string' || value.length > 2000) throw new AppUseError('APP_PARAMS_INVALID', 'Filling an App field needs a string of at most 2000 characters');
      const view = this.document.defaultView!;
      const prototype = element.tagName === 'INPUT' ? view.HTMLInputElement.prototype : view.HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new view.Event('input', { bubbles: true }));
      element.dispatchEvent(new view.Event('change', { bubbles: true }));
    } else throw new AppUseError('APP_USE_INVALID', 'Unknown App DOM action');
    this.invalidate();
    return { verdict: 'not-run' as const };
  }

  geometry(target?: string) {
    let element: Element = this.document.body;
    if (target !== undefined) {
      this.surface.observe(target);
      const found = [...this.document.querySelectorAll('[data-app-object]')].find(node => node.getAttribute('data-app-object') === target);
      if (!found || !visible(found)) throw new AppUseError('APP_OBJECT_NOT_RENDERED', 'The declared App object has no visible data-app-object element');
      element = found;
    }
    const box = element.getBoundingClientRect();
    const view = this.document.defaultView!;
    const x = Math.max(0, Math.ceil(box.left)), y = Math.max(0, Math.ceil(box.top));
    const width = Math.min(view.innerWidth, Math.floor(box.right)) - x;
    const height = Math.min(view.innerHeight, Math.floor(box.bottom)) - y;
    if (width <= 0 || height <= 0) throw new AppUseError('APP_OBJECT_NOT_RENDERED', 'The App target is outside its visible viewport');
    return { rect: { x, y, width, height }, ...(target === undefined ? {} : { target }) };
  }

  annotation() {
    const { rect } = this.geometry();
    const elements = [...this.document.querySelectorAll(`[data-app-object],${controls}`)].filter(visible).slice(0, 300);
    return {
      ...this.surface.observe(), rect, viewport: { width: rect.width, height: rect.height },
      annotationDom: elements.map((element, index) => {
        const box = element.getBoundingClientRect();
        return { id: `element-${index}`, kind: element.tagName.toLowerCase(), label: label(element), role: role(element),
          ...(element.getAttribute('data-app-object') ? { semanticId: element.getAttribute('data-app-object')! } : {}),
          bounds: { x: box.left - rect.x, y: box.top - rect.y, width: box.width, height: box.height } };
      }),
    };
  }
}

/** Associates a rendered App element with its declared semantic object. */
export const appObjectProps = (id: string) => ({ 'data-app-object': id });
