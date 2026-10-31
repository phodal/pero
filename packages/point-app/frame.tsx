import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppApiProvider, applyTheme, createAppExamples, readAppExample, Select } from 'point-sdk';
import 'point-sdk-client';
import 'point-tokens';
import { createAppSurface } from 'point-sdk';
import { installAppUseBridge, AppUseError } from '../app-sdk/src/app-use';
const app = await (await fetch('./point-manifest.json')).json();
const surface = createAppSurface({ appName: app.name, tabId: document.documentElement.dataset.pointPanel });
const examples = createAppExamples({ entries: (app.contributes.examples ?? []).filter((entry: {panelId: string}) => entry.panelId === document.documentElement.dataset.pointPanel),
  read: async (entry: {entry: string}, signal: AbortSignal) => readAppExample(await fetch('./point-ui/' + entry.entry, { signal }), entry),
});
const launchChat = (options: Record<string, unknown> = {}) => {
  for (const key of Object.keys(options)) {
    if (!['message', 'mode', 'attachments', 'capture', 'submit'].includes(key) || key === 'submit' && options[key] !== false)
      throw new Error(`Point chat option is unavailable: ${key}`);
  }
  const { submit: _submit, ...draft } = options;
  return new Promise<void>((resolve, reject) => {
    const id = crypto.randomUUID();
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'pero:app:chat-result' || event.data.id !== id) return;
      clearTimeout(timer); window.removeEventListener('message', receive);
      event.data.ok ? resolve() : reject(new Error(event.data.error || 'Chat launch failed'));
    };
    const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('Chat launch timed out')); }, 125000);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'pero:app:chat', id, options: draft }, '*');
  });
};

const observed = (target?: string) => {
  const snapshot = surface.snapshot();
  if (target !== undefined) {
    snapshot.objects = snapshot.objects.filter((object: {id: string}) => object.id === target);
    if (!snapshot.objects.length) throw new AppUseError('APP_OBJECT_UNKNOWN', `Unknown App object ${target}`);
  }
  return snapshot;
};
const bridge = {
  observe: observed,
  verify(target: string, key: string, expected: unknown) {
    const state = observed(target).objects[0].state;
    const found = !!state && typeof state === 'object' && Object.hasOwn(state, key);
    const actual = found ? state[key] : null;
    return { found, actual, verdict: found && JSON.stringify(actual) === JSON.stringify(expected) ? 'pass' as const : 'fail' as const };
  },
  async invoke(target: string, action: string, input: Record<string, unknown>, revision: number) {
    if (observed(target).objects[0].revision !== revision) throw new AppUseError('APP_REVISION_STALE', 'Observe the App object again before invoking');
    return { verdict: 'not-run' as const, result: await surface.invoke(target, action, input) };
  },
};

const unavailable = () => { throw new Error('This Point Host operation is unavailable in Pero'); };
const prefix = `/apps/${app.name}`;
const backendFetch: typeof fetch = (input, init) => {
  if (typeof input !== 'string' || !(input === '/api/projects' || input.startsWith('/api/projects/') || input.startsWith(prefix + '/api/') || app.permissions?.storage && input === `/api/apps/${app.name}/config`))
    throw new Error('Only this App backend is available');
  return fetch(input, { ...init, redirect: 'error' });
};
const noEvents = () => { throw new Error('Point events are unavailable in Pero'); };

class Boundary extends React.Component<{children: React.ReactNode}, {error: string}> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <main role="alert"><h1>{app.displayName}</h1><p>{this.state.error}</p><button onClick={() => location.reload()}>Reload / 重新加载</button></main> : this.props.children;
  }
}
function Frame({ Panel }: {Panel: React.ComponentType}) {
  const [context, setContext] = useState({ locale: 'en', dark: false, active: false });
  const [notice, setNotice] = useState('');
  const [exampleState, setExampleState] = useState(examples.getSnapshot());
  useEffect(() => examples.subscribe(() => setExampleState(previous => {
    const next = examples.getSnapshot();
    return previous.ready === next.ready && previous.busy === next.busy && previous.error === next.error && previous.selected === next.selected ? previous : next;
  })), []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (event.data?.type !== 'pero:app:context') return;
      const next = event.data.context;
      if (!next || !['en', 'zh-CN'].includes(next.locale) || typeof next.dark !== 'boolean' || typeof next.active !== 'boolean') return;
      applyTheme(next.dark ? 'point-dark' : 'point-light');
      document.documentElement.lang = next.locale;
      document.documentElement.style.colorScheme = next.dark ? 'dark' : 'light';
      examples.setActive(next.active);
      setContext({ locale: next.locale, dark: next.dark, active: next.active });
    };
    const stop = installAppUseBridge(bridge);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'pero:app:ready' }, '*');
    return () => { window.removeEventListener('message', receive); stop(); };
  }, []);
  return <AppApiProvider appName={app.name} appVersion={app.version} locale={context.locale}
    allowedApiPaths={app.permissions?.api ?? []} allowedEvents={[]} active={context.active}
    fetch={backendFetch} surface={surface} examples={examples} subscribeFn={noEvents} navigateFn={unavailable} notifyFn={setNotice}
    setBadgeFn={unavailable} launchChatFn={launchChat}>
    {!!app.contributes.examples?.length && <Select label={context.locale === 'zh-CN' ? '示例' : 'Example'} value={exampleState.selected?.id ?? ''}
      disabled={!exampleState.ready || exampleState.busy} options={app.contributes.examples.map((entry: any) => ({ value: entry.id, label: entry.localizations?.[context.locale === 'zh-CN' ? 'zh' : 'en']?.title ?? entry.title }))}
      onChange={(id: string) => { void examples.load(id); }}/>}
    {exampleState.error && <p role="alert">{exampleState.error}</p>}
    {notice && <div role="status">{notice}</div>}<Boundary><Panel/></Boundary>
  </AppApiProvider>;
}
// Register the shared modules before evaluating the unchanged Point bundle.
applyTheme('point-light');
const root = createRoot(document.getElementById('app')!);
const panelEntry = app.contributes.panelTabs.find((panel: {id: string}) => panel.id === document.documentElement.dataset.pointPanel).entry;
const panelURL = new URL('./point-ui/' + panelEntry, import.meta.url);
import(panelURL.href).then(module => {
  root.render(<Frame Panel={module.default}/>);
}).catch(error => root.render(<main role="alert">{String(error)}</main>));
