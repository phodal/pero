import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from '@pero/app-sdk';
import { Button, EnvironmentBrowser, Feedback, LibraryHeader } from '@pero/app-sdk/ui';

class EnvironmentBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <main><LibraryHeader title="Environments could not load" density="compact"/>
      <Feedback kind="error" variant="block">{this.state.error} <Button onClick={() => location.reload()}>Reload</Button></Feedback></main> : this.props.children;
  }
}

createRoot(document.getElementById('app')!).render(
  <AppProvider><EnvironmentBoundary><EnvironmentBrowser /></EnvironmentBoundary></AppProvider>,
);
