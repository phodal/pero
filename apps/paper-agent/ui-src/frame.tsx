import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useAppContext } from '@pero/app-sdk';
import { Button, Feedback, LibraryHeader } from '@pero/app-sdk/ui';
import PaperAgent from './index';

function PaperLoadError({ message }: { message: string }) {
  const { locale } = useAppContext();
  const zh = locale === 'zh-CN';
  return <main role="alert"><LibraryHeader density="compact" title={zh ? '论文无法加载' : 'Papers could not load'} /><Feedback kind="error" variant="block">{message} <Button onClick={() => location.reload()}>{zh ? '重新加载' : 'Reload'}</Button></Feedback></main>;
}
class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <PaperLoadError message={this.state.error} /> : this.props.children;
  }
}
createRoot(document.getElementById('app')!).render(<AppProvider><AppErrorBoundary><PaperAgent/></AppErrorBoundary></AppProvider>);
