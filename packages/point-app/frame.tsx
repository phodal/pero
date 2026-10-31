import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppApiProvider, applyTheme } from 'point-sdk';
import 'point-sdk-client';
import 'point-tokens';
import app from 'point-manifest';

const unavailable = () => { throw new Error('This Point Host operation is unavailable in Pero'); };
const prefix = `/apps/${app.name}`;
const backendFetch: typeof fetch = (input, init) => {
  if (typeof input !== 'string' || !input.startsWith(prefix + '/api/'))
    throw new Error('Only this App backend is available');
  return fetch(input.slice(prefix.length), { ...init, redirect: 'error' });
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
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (event.data?.type === 'pero:app-use:request') {
        window.parent.postMessage({ type: 'pero:app-use:result', id: event.data.id, ok: false,
          error: { code: 'APP_USE_UNAVAILABLE', message: 'Point App Use is not available in this adapter' } }, event.origin === 'null' ? '*' : event.origin);
        return;
      }
      if (event.data?.type !== 'pero:app:context') return;
      const next = event.data.context;
      if (!next || !['en', 'zh-CN'].includes(next.locale) || typeof next.dark !== 'boolean' || typeof next.active !== 'boolean') return;
      applyTheme(next.dark ? 'point-dark' : 'point-light');
      document.documentElement.lang = next.locale;
      document.documentElement.style.colorScheme = next.dark ? 'dark' : 'light';
      setContext({ locale: next.locale, dark: next.dark, active: next.active });
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'pero:app:ready' }, '*');
    return () => window.removeEventListener('message', receive);
  }, []);
  return <AppApiProvider appName={app.name} appVersion={app.version} locale={context.locale}
    allowedApiPaths={app.permissions?.api ?? []} allowedEvents={[]} active={context.active}
    fetch={backendFetch} subscribeFn={noEvents} navigateFn={unavailable} notifyFn={setNotice}
    setBadgeFn={unavailable} launchChatFn={unavailable}>
    {notice && <div role="status">{notice}</div>}<Boundary><Panel/></Boundary>
  </AppApiProvider>;
}
// Register the shared modules before evaluating the unchanged Point bundle.
applyTheme('point-light');
const root = createRoot(document.getElementById('app')!);
import('./point-ui/' + app.contributes.panelTabs[0].entry).then(module => {
  root.render(<Frame Panel={module.default}/>);
}).catch(error => root.render(<main role="alert">{String(error)}</main>));
