import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useAppChat, useAppContext } from '@pero/app-sdk';
import { ConnectorsPage } from './connectors-page';
import { Button, Feedback, LibraryHeader } from './ui';
import './styles.css';

function Connectors() {
  const { locale } = useAppContext(), chat = useAppChat();
  return <ConnectorsPage locale={locale === 'zh-CN' ? 'zh' : 'en'} onTry={async prompt => { await chat.compose(prompt); }}/>;
}
function ConnectorsLoadError({ message }: { message: string }) {
  const { locale } = useAppContext();
  const zh = locale === 'zh-CN';
  return <main role="alert"><LibraryHeader density="compact" title={zh ? '连接器无法加载' : 'Connectors could not load'} /><Feedback kind="error" variant="block">{message} <Button onClick={() => location.reload()}>{zh ? '重试' : 'Retry'}</Button></Feedback></main>;
}
class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <ConnectorsLoadError message={this.state.error} /> : this.props.children; }
}
createRoot(document.getElementById('app')!).render(<AppProvider><AppErrorBoundary><Connectors/></AppErrorBoundary></AppProvider>);
