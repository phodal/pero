import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useAppContext } from '@pero/app-sdk';
import { AutomationPage } from 'point-automation-page';
import { applyTheme } from 'point-themes';
import 'point-tokens';
import 'point-workbench-style';
import 'point-pulse-style';
import { installAutomationTransport } from './transport';
import './frame.css';

installAutomationTransport();
applyTheme('point-light');

function Automations() {
  const context = useAppContext();
  const [narrow, setNarrow] = useState(() => innerWidth < 720);
  useEffect(() => {
    const resize = () => setNarrow(innerWidth < 720);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useLayoutEffect(() => {
    applyTheme(context.dark ? 'point-dark' : 'point-light');
    document.documentElement.lang = context.locale;
  }, [context.dark, context.locale]);
  return <main className="point-workbench automation-app" data-narrow={narrow}>
    <header className="point-topbar">
      <div className="point-topbar-page" id="point-topbar-page" />
      <div className="point-topbar-page-actions" id="point-topbar-page-actions" />
    </header>
    <AutomationPage locale={context.locale === 'zh-CN' ? 'zh' : 'en'} openSession={sessionId => {
      window.parent.postMessage({ type: 'pero:app:open-session', sessionId }, '*');
    }} />
  </main>;
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <main role="alert"><h1>Automations</h1><p>{this.state.error}</p><button onClick={() => location.reload()}>Retry / 重试</button></main> : this.props.children;
  }
}
createRoot(document.getElementById('app')!).render(<AppProvider><AppErrorBoundary><Automations /></AppErrorBoundary></AppProvider>);
