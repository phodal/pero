import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import RFB from '@novnc/novnc';
import { Button, Feedback, Input } from '@pero/app-sdk/ui';
import '@pero/app-sdk/tokens.css';
import { translate, type MessageKey } from '../../../locales/index.ts';
import type { DesktopAction, DesktopSnapshot, LinuxDesktopBridge } from '../preload/linux-desktop.ts';
import { connectPair, publishRfb } from './paired-transport.ts';
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
  const [pair, setPair] = useState<DesktopSnapshot['pair']>();
  const [paired, setPaired] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('5900');
  const [credentials, setCredentials] = useState<('username' | 'password' | 'target')[]>([]);
  const receiver = useRef<RFB>(null);
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
    setCredentials([]);
    const client = new RFB(target, state.endpoint);
    receiver.current = client;
    client.viewOnly = !controlling;
    client.scaleViewport = true;
    const connected = () => setFrame('connected');
    const closed = () => setFrame('closed');
    const authenticate = (event: Event) => setCredentials((event as CustomEvent<{ types: typeof credentials }>).detail.types);
    client.addEventListener('connect', connected);
    client.addEventListener('disconnect', closed);
    client.addEventListener('credentialsrequired', authenticate);
    return () => {
      client.removeEventListener('connect', connected);
      client.removeEventListener('disconnect', closed);
      client.removeEventListener('credentialsrequired', authenticate);
      client.disconnect();
      receiver.current = null;
      target.replaceChildren();
    };
  }, [state?.endpoint, controlling, retry]);

  useEffect(() => {
    if (!pair || !state?.sharing) return;
    let disposed = false;
    let closeDisplay: (() => void) | undefined;
    const disconnect = () => {
      if (disposed) return;
      setPair(undefined);
      void window.peroLinuxDesktop.invoke('end-share').then(setState, err => setError(err.message));
    };
    const closePair = connectPair(pair, 'owner', channel => {
      setPaired(true);
      closeDisplay = publishRfb(pair.endpoint, channel, disconnect);
    }, disconnect);
    return () => {
      disposed = true;
      setPaired(false);
      closeDisplay?.();
      closePair();
    };
  }, [pair, state?.sharing]);

  async function act(action: DesktopAction) {
    setError(''); setPending(action);
    try {
      if (action === 'end-share' || action === 'stop') setPair(undefined);
      const result = await window.peroLinuxDesktop.invoke(action, action === 'connect' ? { host, port: Number(port) } : undefined);
      setState(result);
      if (result.pair) setPair(result.pair);
    }
    catch (err) { setError(err instanceof Error ? err.message.replace(/^Error invoking remote method 'pero:linux-desktop': Error: /, '') : String(err)); }
    finally { setPending(undefined); }
  }

  const blocked = !state || !!pending || ['starting', 'handoff', 'stopping'].includes(state.phase);
  const watching = state?.phase === 'watching';
  return <main>
    <header>
      <div className="heading">
        <h1>{t('linux_desktop.title')}</h1>
        <Feedback>{t(state?.sharing ? paired ? 'linux_desktop.shared' : 'linux_desktop.await_peer' :
          state ? phaseLabels[state.phase] : 'linux_desktop.loading')}</Feedback>
      </div>
      <div className="actions">
        {state?.sharing ? <Button variant="primary" disabled={blocked} onClick={() => void act('end-share')}>{t('linux_desktop.end_share')}</Button>
          : state?.external ? <Button disabled={blocked} onClick={() => void act('stop')}>{t('linux_desktop.disconnect_host')}</Button> : state?.hasGuest ? <>
          {watching && <Button variant="primary" disabled={blocked} onClick={() => void act('takeover')}>{t('linux_desktop.takeover')}</Button>}
          {controlling && <Button variant="primary" disabled={blocked} onClick={() => void act('return')}>{t('linux_desktop.return')}</Button>}
          {state.relayAvailable && (watching || controlling) && <Button disabled={blocked} onClick={() => void act('share')}>
            {t(controlling ? 'linux_desktop.share_control' : 'linux_desktop.share_view')}
          </Button>}
          <Button disabled={blocked} onClick={() => void act('stop')}>{t(state.remoteManaged ? 'linux_desktop.disconnect_host' : 'linux_desktop.stop')}</Button>
        </> : (!state?.sshHost || state.sshHost.managed) &&
          <Button variant="primary" disabled={blocked} onClick={() => void act('start')}>{t(state?.sshHost ? 'linux_desktop.attach_host' : 'linux_desktop.start')}</Button>}
      </div>
    </header>
    {(error || state?.error) && <Feedback kind="error" variant="block" className="problem">{error || state?.error}</Feedback>}
    <section className="display" aria-label={t('linux_desktop.screen')}>
      <div ref={surface} className="framebuffer" data-frame={state?.endpoint ? frame : 'absent'} />
      {state?.endpoint && frame !== 'connected' ? <div className="display-message">
        <Feedback>{t(frame === 'closed' ? 'linux_desktop.disconnected' : 'linux_desktop.connecting')}</Feedback>
        {frame === 'closed' && <Button disabled={blocked} onClick={() => setRetry(value => value + 1)}>{t('linux_desktop.reconnect')}</Button>}
        {frame !== 'closed' && credentials.length > 0 && <form className="connection" onSubmit={event => {
          event.preventDefault();
          const entries = Object.fromEntries(new FormData(event.currentTarget));
          receiver.current?.sendCredentials(Object.fromEntries(credentials.map(key => [key, String(entries[key] ?? '')])));
          setCredentials([]);
        }}>
          {credentials.map(key => <label key={key}>{t(`linux_desktop.vnc_${key}`)}
            <Input name={key} type={key === 'password' ? 'password' : 'text'} autoComplete="off" required />
          </label>)}
          <Button type="submit" variant="primary">{t('linux_desktop.connect')}</Button>
        </form>}
      </div> : !state?.endpoint && <div className="display-message">
        {pair && state?.sharing && <div className="connection">
          <label>{t('linux_desktop.pair_link')}<Input value={pair.invite} readOnly /></label>
          <Button onClick={() => void navigator.clipboard.writeText(pair.invite)}>{t('linux_desktop.copy_link')}</Button>
        </div>}
        {state && !state.hasGuest && !blocked && <>
          {!state.sshHost && <Feedback kind="empty">{t('linux_desktop.disposable')}</Feedback>}
          <form className="connection" onSubmit={event => { event.preventDefault(); void act('connect'); }}>
            <label>{t('linux_desktop.ssh_host')}<Input value={host} onChange={event => setHost(event.target.value)} required /></label>
            <label>{t('linux_desktop.vnc_port')}<Input type="number" min={1} max={65535} value={port} onChange={event => setPort(event.target.value)} required /></label>
            <Button type="submit">{t('linux_desktop.connect')}</Button>
          </form>
        </>}
      </div>}
    </section>
    <footer>
      <span>{state?.external ? `${state.external.host} · VNC` : t(state?.attached ? 'linux_desktop.attached' : 'linux_desktop.detached')}</span>
      {!state?.external && (state?.attached ? <Button disabled={blocked} onClick={() => void act('detach')}>{t('linux_desktop.detach')}</Button>
        : watching && (state.enabled
          ? <Button disabled={blocked} onClick={() => void act('attach')}>{t('linux_desktop.attach')}</Button>
          : <Button disabled={blocked} onClick={() => void act('enable')}>{t('computer.enable')}</Button>))}
    </footer>
  </main>;
}

createRoot(document.getElementById('app')!).render(<Viewer />);
