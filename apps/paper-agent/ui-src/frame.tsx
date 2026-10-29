import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from '@pero/app-sdk';
import { Button } from '@pero/app-sdk/ui';
import PaperAgent from './index';

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <main role="alert" style={{ padding: 24 }}><p>{this.state.error}</p><Button onClick={() => location.reload()}>Reload / 重新加载</Button></main> : this.props.children;
  }
}
createRoot(document.getElementById('app')!).render(<AppProvider><AppErrorBoundary><PaperAgent/></AppErrorBoundary></AppProvider>);
