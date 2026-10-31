import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useAppChat, useAppContext } from '@pero/app-sdk';
import { ConnectorsPage } from './connectors-page';
import './styles.css';

function Connectors() {
  const { locale } = useAppContext(), chat = useAppChat();
  return <ConnectorsPage locale={locale === 'zh-CN' ? 'zh' : 'en'} onTry={async prompt => { await chat.compose(prompt); }}/>;
}
class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <main role="alert"><h1>Connectors</h1><p>{this.state.error}</p><button onClick={() => location.reload()}>Retry / 重试</button></main> : this.props.children; }
}
createRoot(document.getElementById('app')!).render(<AppProvider><AppErrorBoundary><Connectors/></AppErrorBoundary></AppProvider>);
