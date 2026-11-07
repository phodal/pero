import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from '@pero/app-sdk';
import Data from './index';
import { Disclosure, Button, Feedback } from '@pero/app-sdk/ui';
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <main className="data-landing"><Feedback kind="error" variant="block">Data could not load. <Button onClick={() => location.reload()}>Reload</Button><Disclosure variant="inline" summary={<>Details</>}><pre>{this.state.error}</pre></Disclosure></Feedback></main> : this.props.children;
  }
}
createRoot(document.getElementById('app')!).render(<AppProvider><ErrorBoundary><Data /></ErrorBoundary></AppProvider>);
