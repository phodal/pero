import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useAppApi, useAppChat, useAppDataChanged } from '@pero/app-sdk';
import { mountLab } from './lab.mjs';
import './styles.css';

function Lab() {
  const root = useRef<HTMLDivElement>(null);
  const view = useRef<ReturnType<typeof mountLab> | null>(null);
  const api = useAppApi();
  const chat = useAppChat();
  const chatRef = useRef(chat);
  chatRef.current = chat;
  useEffect(() => {
    if (!root.current) return;
    const mounted = mountLab(root.current, {
      get: path => api.get(path), post: (path, payload) => api.post(path, payload),
      ask: prompt => chatRef.current.compose(prompt),
    });
    view.current = mounted;
    return () => { mounted.destroy(); view.current = null; };
  }, [api]);
  useAppDataChanged(() => view.current?.refresh());
  return <div ref={root} />;
}

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: string}> {
  state = {error: ''};
  static getDerivedStateFromError(error: Error) { return {error: error.message}; }
  render() {
    return this.state.error ? <main role="alert"><h1>Lab could not load</h1>
      <p>{this.state.error}</p><button onClick={() => location.reload()}>Reload</button></main> : this.props.children;
  }
}
createRoot(document.getElementById('app')!).render(<AppProvider><ErrorBoundary><Lab /></ErrorBoundary></AppProvider>);
