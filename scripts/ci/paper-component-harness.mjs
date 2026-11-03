import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { runInNewContext } from 'node:vm';

// Execute complete production components, not source fragments. This shallow
// hook host leaves DOM/PDF rendering to e2e; effects and handlers run unchanged.
export function paperComponents(api) {
  let current;
  const storage = new Map();
  const react = {
    createElement(type, props, ...children) { return { type, key: props?.key, props: { ...props, children } }; },
    Fragment: 'Fragment',
    useState(initial) {
      const host = current, index = host.cursor++;
      if (!(index in host.slots)) host.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [host.slots[index], value => { host.slots[index] = typeof value === 'function' ? value(host.slots[index]) : value; }];
    },
    useRef(value) { return react.useState(() => ({ current: value }))[0]; },
    useMemo(callback, deps) {
      const host = current, index = host.cursor++, previous = host.slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) host.slots[index] = { deps, value: callback() };
      return host.slots[index].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const host = current, index = host.cursor++, previous = host.slots[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        host.effects.push(() => { previous?.cleanup?.(); host.slots[index] = { deps, cleanup: callback() }; });
      }
    },
  };
  const sdk = { useAppApi: () => api, useAppChat: () => ({}), useAppInfo: () => ({ active: true }),
    useAppI18n: () => ({ t: key => key }), useAppContext: () => ({ active: true, locale: 'en', dark: false }), useAppObject() {}, useAppDataChanged() {}, appObjectProps: () => ({}) };
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const path = new URL(`../../apps/paper-agent/ui-src/${name}`, import.meta.url);
    const code = transformSync(readFileSync(path, 'utf8'), { loader: name.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'transform' }).code;
    const module = { exports: {} };
    const require = specifier => {
      if (specifier === 'react') return react;
      if (specifier === 'react-dom') return { createPortal: children => children };
      if (specifier === '@pero/app-sdk') return sdk;
      if (['./documents', './pdf-reader', './structured-reading'].includes(specifier)) return load(`${specifier.slice(2)}.tsx`);
      if (['./reader-state', './shelf', './research-types'].includes(specifier)) return load(`${specifier.slice(2)}.ts`);
      // Child views are opaque elements; no child domain behavior is faked.
      return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
    };
    runInNewContext(code, { module, exports: module.exports, require, console, Error,
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
      window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} },
    }, { filename: path.pathname });
    cache.set(name, module.exports);
    return module.exports;
  }
  function mount(component, props = {}) {
    const host = { slots: [], cursor: 0, effects: [], props, tree: null,
      render(next = host.props) {
        host.props = next; host.cursor = 0; host.effects = []; current = host;
        try { host.tree = component(next); } finally { current = null; }
        for (const effect of host.effects) effect();
        return host.tree;
      },
      unmount() { for (const slot of host.slots) slot?.cleanup?.(); },
    };
    host.render();
    return host;
  }
  return { ...load('documents.tsx'), ...load('structured-reading.tsx'), ...load('pdf-reader.tsx'),
    PaperAgent: load('index.tsx').default, mount, storage };
}

export function elements(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => elements(child, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...elements(tree.props?.children, predicate)];
}
export const drain = () => new Promise(resolve => setImmediate(resolve));
