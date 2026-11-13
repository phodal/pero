import React from 'react';
import {createRoot} from 'react-dom/client';
import {AppProvider, useAppContext} from '@pero/app-sdk';
import {Button, Feedback, LibraryHeader} from '@pero/app-sdk/ui';
import {SkillsMarket} from './market';
import './styles.css';

function SkillsLoadError({ message }: { message: string }) {
  const { locale } = useAppContext();
  const zh = locale === 'zh-CN';
  return <main role="alert"><LibraryHeader density="compact" title={zh ? '技能无法加载' : 'Skills could not load'} /><Feedback kind="error" variant="block">{message} <Button onClick={() => location.reload()}>{zh ? '重试' : 'Retry'}</Button></Feedback></main>;
}
class Boundary extends React.Component<{children: React.ReactNode}, {error: string}> {
  state = {error: ''};
  static getDerivedStateFromError(error: Error) { return {error:error.message}; }
  render() { return this.state.error ? <SkillsLoadError message={this.state.error} /> : this.props.children; }
}
createRoot(document.getElementById('app')!).render(<AppProvider><Boundary><SkillsMarket/></Boundary></AppProvider>);
