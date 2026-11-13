import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useAppContext } from '@pero/app-sdk';
import { Button, EnvironmentBrowser, Feedback, LibraryHeader } from '@pero/app-sdk/ui';
import './styles.css';

function EnvironmentLoadError({ message }: { message: string }) {
  const { locale } = useAppContext();
  const zh = locale === 'zh-CN';
  return <main><LibraryHeader title={zh ? '执行环境无法加载' : 'Environments could not load'} density="compact"/>
    <Feedback kind="error" variant="block">{message} <Button onClick={() => location.reload()}>{zh ? '重新加载' : 'Reload'}</Button></Feedback></main>;
}
class EnvironmentBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <EnvironmentLoadError message={this.state.error} /> : this.props.children;
  }
}

createRoot(document.getElementById('app')!).render(
  <AppProvider><EnvironmentBoundary><EnvironmentBrowser /></EnvironmentBoundary></AppProvider>,
);
