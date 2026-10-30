import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from '@pero/app-sdk';
import Insights from './index';

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error
      ? <main role="alert"><h1>Insights</h1><p>{this.state.error}</p><button type="button" onClick={() => location.reload()}>Retry</button></main>
      : this.props.children;
  }
}

createRoot(document.getElementById('app')!).render(
  <AppProvider><AppErrorBoundary><Insights /></AppErrorBoundary></AppProvider>,
);
