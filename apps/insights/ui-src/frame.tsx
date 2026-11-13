import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useAppContext } from '@pero/app-sdk';
import { Button, Feedback, LibraryHeader } from '@pero/app-sdk/ui';
import Insights from './index';

function InsightsLoadError({ message }: { message: string }) {
  const { locale } = useAppContext();
  const zh = locale === 'zh-CN';
  return <main><LibraryHeader title={zh ? '简报无法加载' : 'Insights could not load'} density="compact"/><Feedback kind="error" variant="block">{message} <Button onClick={() => location.reload()}>{zh ? '重试' : 'Retry'}</Button></Feedback></main>;
}
class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <InsightsLoadError message={this.state.error} /> : this.props.children;
  }
}

createRoot(document.getElementById('app')!).render(
  <AppProvider><AppErrorBoundary><Insights /></AppErrorBoundary></AppProvider>,
);
