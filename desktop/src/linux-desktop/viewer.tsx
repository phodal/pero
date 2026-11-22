import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import RFB from '@novnc/novnc';
import { Button, Feedback } from '@pero/app-sdk/ui';
import '@pero/app-sdk/tokens.css';
import { translate, type MessageKey } from '../../../locales/index.ts';
import type { DesktopAction, DesktopSnapshot, LinuxDesktopBridge } from '../preload/linux-desktop.ts';
import './viewer.css';

declare global {
  interface Window { peroLinuxDesktop: LinuxDesktopBridge }
}

const phaseLabels = {
  stopped: 'linux_desktop.stopped', starting: 'linux_desktop.starting', watching: 'linux_desktop.watching',
  handoff: 'linux_desktop.handoff', controlling: 'linux_desktop.controlling', stopping: 'linux_desktop.stopping', failed: 'linux_desktop.failed',
} as const;

function Viewer() {
  const [state, setState] = useState<DesktopSnapshot>();
  const [pending, setPending] = useState<DesktopAction>();
  const [error, setError] = useState('');
  const [frame, setFrame] = useState<'connecting' | 'connected' | 'closed'>('connecting');
  const [retry, setRetry] = useState(0);
  const surface = useRef<HTMLDivElement>(null);
  const t = (key: MessageKey) => translate(state?.locale ?? 'en', key);
  const controlling = state?.phase === 'controlling';

  useEffect(() => {
    const api = window.peroLinuxDesktop;
    const stop = api.listen(setState);
    void api.invoke('state').then(setState, err => setError(err.message));
    return stop;
  }, []);

  useEffect(() => {
    document.documentElement.lang = state?.locale ?? 'en';
    document.documentElement.dataset.theme = state?.dark ? 'dark' : 'light';
    document.title = translate(state?.locale ?? 'en', 'linux_desktop.title');
  }, [state?.locale, state?.dark]);

  useEffect(() => {
    const target = surface.current;
    if (!target || !state?.endpoint) return;
    setFrame('connecting');
    const client = new RFB(target, state.endpoint);
    client.viewOnly = !controlling;
    client.scaleViewport = true;
    const connected = () => setFrame('connected');
    const closed = () => setFrame('closed');
    client.addEventListener('connect', connected);
    client.addEventListener('disconnect', closed);
    return () => {
      client.removeEventListener('connect', connected);
      client.removeEventListener('disconnect', closed);
      client.disconnect();
      target.replaceChildren();
    };
  }, [state?.endpoint, controlling, retry]);

  async function act(action: DesktopAction) {
    setError(''); setPending(action);
    try { setState(await window.peroLinuxDesktop.invoke(action)); }
    catch (err) { setError(err instanceof Error ? err.message.replace(/^Error invoking remote method 'pero:linux-desktop': Error: /, '') : String(err)); }
    finally { setPending(undefined); }
  }

  const blocked = !state || !!pending || ['starting', 'handoff', 'stopping'].includes(state.phase);
  const watching = state?.phase === 'watching';
  return <main>
    <header>
      <div className="heading">
        <h1>{t('linux_desktop.title')}</h1>
        <Feedback>{t(state ? phaseLabels[state.phase] : 'linux_desktop.loading')}</Feedback>
      </div>
      <div className="actions">
        {state?.hasGuest ? <>
          {watching && <Button variant="primary" disabled={blocked} onClick={() => void act('takeover')}>{t('linux_desktop.takeover')}</Button>}
          {controlling && <Button variant="primary" disabled={blocked} onClick={() => void act('return')}>{t('linux_desktop.return')}</Button>}
          <Button disabled={blocked} onClick={() => void act('stop')}>{t('linux_desktop.stop')}</Button>
        </> : <Button variant="primary" disabled={blocked} onClick={() => void act('start')}>{t('linux_desktop.start')}</Button>}
      </div>
    </header>
    {(error || state?.error) && <Feedback kind="error" variant="block" className="problem">{error || state?.error}</Feedback>}
    <section className="display" aria-label={t('linux_desktop.screen')}>
      <div ref={surface} className="framebuffer" data-frame={state?.endpoint ? frame : 'absent'} />
      {state?.endpoint && frame !== 'connected' ? <div className="display-message">
        <Feedback>{t(frame === 'closed' ? 'linux_desktop.disconnected' : 'linux_desktop.connecting')}</Feedback>
        {frame === 'closed' && <Button disabled={blocked} onClick={() => setRetry(value => value + 1)}>{t('linux_desktop.reconnect')}</Button>}
      </div> : !state?.endpoint && <div className="display-message">
        <Feedback kind="empty">{t(state?.phase === 'stopped' ? 'linux_desktop.disposable' : state ? phaseLabels[state.phase] : 'linux_desktop.loading')}</Feedback>
      </div>}
    </section>
    <footer>
      <span>{t(state?.attached ? 'linux_desktop.attached' : 'linux_desktop.detached')}</span>
      {state?.attached ? <Button disabled={blocked} onClick={() => void act('detach')}>{t('linux_desktop.detach')}</Button>
        : watching && (state.enabled
          ? <Button disabled={blocked} onClick={() => void act('attach')}>{t('linux_desktop.attach')}</Button>
          : <Button disabled={blocked} onClick={() => void act('enable')}>{t('computer.enable')}</Button>)}
    </footer>
  </main>;
}

createRoot(document.getElementById('app')!).render(<Viewer />);
