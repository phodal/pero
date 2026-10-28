import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from '@pero/app-sdk';
import VirtualCell from './index';

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    if (this.state.error) return <main role="alert" style={{ padding: 24 }}><h1>Virtual Cell</h1><p>{this.state.error}</p><button onClick={() => location.reload()}>Reload / 重新加载</button></main>;
    return this.props.children;
  }
}
createRoot(document.getElementById('app')!).render(<AppProvider><AppErrorBoundary><VirtualCell/></AppErrorBoundary></AppProvider>);
