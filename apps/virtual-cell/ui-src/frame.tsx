import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useAppContext } from '@pero/app-sdk';
import { Button, Feedback, LibraryHeader } from '@pero/app-sdk/ui';
import VirtualCell from './index';

function VirtualCellLoadError({ message }: { message: string }) {
  const { locale } = useAppContext();
  const zh = locale === 'zh-CN';
  return <main><LibraryHeader title={zh ? '虚拟细胞无法加载' : 'Virtual Cell could not load'} density="compact"/><Feedback kind="error" variant="block">{message} <Button onClick={() => location.reload()}>{zh ? '重新加载' : 'Reload'}</Button></Feedback></main>;
}
class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    if (this.state.error) return <VirtualCellLoadError message={this.state.error} />;
    return this.props.children;
  }
}
createRoot(document.getElementById('app')!).render(<AppProvider><AppErrorBoundary><VirtualCell/></AppErrorBoundary></AppProvider>);
