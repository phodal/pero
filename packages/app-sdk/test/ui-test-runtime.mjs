import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

/** Render the actual components with the same pinned React as the App SDK. */
export async function createUiRuntime(t, component) {
  const upstream = resolve(import.meta.dirname, '../../..');
  const require = createRequire(import.meta.url);
  const { JSDOM } = require('jsdom');
  const temporary = await mkdtemp(resolve(tmpdir(), 'pero-ui-components-'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const keys = ['CSS', 'window', 'Window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'HTMLButtonElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'SVGElement', 'Element', 'Node', 'NodeFilter', 'MutationObserver', 'Event', 'CustomEvent', 'ResizeObserver', 'devicePixelRatio', 'matchMedia', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', '__pero_modules'];
  const previous = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) if (key in dom.window) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  // CodeMirror reads the constructor via the global Window name, not only window.Window.
  if (!globalThis.Window && dom.window.Window) Object.defineProperty(globalThis, 'Window', { configurable: true, writable: true, value: dom.window.Window });
  globalThis.CSS = dom.window.CSS ?? { escape: createRequire(import.meta.url)('css.escape') };
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  dom.window.ResizeObserver = globalThis.ResizeObserver;
  globalThis.devicePixelRatio = 1;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  // Flush animation setup deterministically during act(), with cancellable IDs.
  const frames = new Map(); let frameId = 0;
  globalThis.requestAnimationFrame = callback => {
    // Callbacks flush as microtasks, so a self-rescheduling frame would starve timers (and --test-timeout) while allocating without bound.
    if (frameId >= 20_000) throw new Error('runaway requestAnimationFrame loop in UI test');
    const id = ++frameId; frames.set(id, callback);
    queueMicrotask(() => { const pending = frames.get(id); frames.delete(id); pending?.(0); });
    return id;
  };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLElement.prototype.scrollTo = function (options) { if (typeof options === 'object') { this.scrollTop = options.top ?? this.scrollTop; this.scrollLeft = options.left ?? this.scrollLeft; } };
  // CodeMirror measures text via Range client rects; jsdom leaves them unimplemented.
  const emptyRect = { x: 0, y: 0, top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0, toJSON() { return this; } };
  const rectList = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  if (dom.window.Range) {
    dom.window.Range.prototype.getBoundingClientRect = function () { return emptyRect; };
    dom.window.Range.prototype.getClientRects = function () { return rectList(); };
  }
  const reactRoot = dirname(require.resolve('react/package.json'));
  const domRoot = dirname(require.resolve('react-dom/package.json'));
  const React = require(resolve(reactRoot, 'index.js'));
  const { createRoot } = require(resolve(domRoot, 'client.js'));
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    try { await React.act(async () => root.unmount()); }
    finally {
      dom.window.close();
      for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
      await rm(temporary, { recursive: true, force: true });
    }
  });
  const { build } = require('esbuild');
  const outfile = resolve(temporary, 'ui.mjs');
  const contents = typeof component === 'object' ? component.contents : component ? `export * from './components/${component}';` : "export * from './ui'; export * as UI from './ui';";
  await build({ stdin: { contents, resolveDir: typeof component === 'object' ? component.resolveDir : resolve(import.meta.dirname, '../src'), loader: 'tsx' }, outfile, banner: { js: "import { createRequire as sdkTestCreateRequire } from 'node:module'; const require = sdkTestCreateRequire(import.meta.url);" }, bundle: true, jsx: 'automatic', platform: 'node', format: 'esm', mainFields: ['module', 'main'], loader: { '.css': typeof component === 'object' && component.cssText ? 'text' : 'empty' }, plugins: [{ name: 'host-react', setup(b) {
    for (const [name, root] of Object.entries(typeof component === 'object' ? component.modules ?? {} : {})) b.onResolve({ filter: new RegExp(`^${name}$`) }, () => ({ path: require.resolve(name, { paths: [root] }) }));
    b.onResolve({ filter: /^@pero\/app-sdk$/ }, () => ({ path: resolve(import.meta.dirname, '../src/index.tsx') }));
    b.onResolve({ filter: /^@pero\/app-sdk\/ui$/ }, () => ({ path: resolve(import.meta.dirname, '../src/ui.tsx') }));
    b.onResolve({ filter: /^@pero\/app-sdk\/chart$/ }, () => ({ path: resolve(import.meta.dirname, '../src/chart/index.tsx') }));
    b.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: resolve(reactRoot, args.path === 'react' ? 'index.js' : args.path.slice(6) + '.js'), external: true }));
    b.onResolve({ filter: /^react-dom(?:\/.*)?$/ }, args => ({ path: resolve(domRoot, args.path === 'react-dom' ? 'index.js' : args.path.slice(10) + '.js'), external: true }));
  } }] });
  const ui = await import(pathToFileURL(outfile));
  const render = element => React.act(async () => root.render(element));
  const click = element => React.act(async () => element.click());
  return { React, dom, root, temporary, upstream, ui, render, click };
}
