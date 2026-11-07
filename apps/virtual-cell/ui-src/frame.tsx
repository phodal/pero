import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from '@pero/app-sdk';
import { Button, Feedback, LibraryHeader } from '@pero/app-sdk/ui';
import VirtualCell from './index';

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    if (this.state.error) return <main><LibraryHeader title="Virtual Cell" density="compact"/><Feedback kind="error" variant="block">{this.state.error} <Button onClick={() => location.reload()}>Reload / 重新加载</Button></Feedback></main>;
    return this.props.children;
  }
}
createRoot(document.getElementById('app')!).render(<AppProvider><AppErrorBoundary><VirtualCell/></AppErrorBoundary></AppProvider>);
