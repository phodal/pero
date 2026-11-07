import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from '@pero/app-sdk';
import { Button, Feedback, LibraryHeader } from '@pero/app-sdk/ui';
import Insights from './index';

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error
      ? <main><LibraryHeader title="Insights" density="compact"/><Feedback kind="error" variant="block">{this.state.error} <Button onClick={() => location.reload()}>Retry</Button></Feedback></main>
      : this.props.children;
  }
}

createRoot(document.getElementById('app')!).render(
  <AppProvider><AppErrorBoundary><Insights /></AppErrorBoundary></AppProvider>,
);
