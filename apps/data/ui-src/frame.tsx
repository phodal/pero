import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useAppContext } from '@pero/app-sdk';
import Data from './index';
import { Disclosure, Button, Feedback, LibraryHeader } from '@pero/app-sdk/ui';
function DataLoadError({ message }: { message: string }) {
  const { locale } = useAppContext();
  const zh = locale === 'zh-CN';
  return <main className="data-landing"><LibraryHeader density="compact" title={zh ? '数据无法加载' : 'Data could not load'} /><Feedback kind="error" variant="block">{message} <Button onClick={() => location.reload()}>{zh ? '重新加载' : 'Reload'}</Button><Disclosure variant="inline" summary={<>{zh ? '详情' : 'Details'}</>}><pre>{message}</pre></Disclosure></Feedback></main>;
}
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <DataLoadError message={this.state.error} /> : this.props.children;
  }
}
createRoot(document.getElementById('app')!).render(<AppProvider><ErrorBoundary><Data /></ErrorBoundary></AppProvider>);
