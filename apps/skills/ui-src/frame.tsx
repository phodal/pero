import React from 'react';
import {createRoot} from 'react-dom/client';
import {AppProvider} from '@pero/app-sdk';
import {Button} from '@pero/app-sdk/ui';
import {SkillsMarket} from './market';
import './styles.css';

class Boundary extends React.Component<{children: React.ReactNode}, {error: string}> {
  state = {error: ''};
  static getDerivedStateFromError(error: Error) { return {error:error.message}; }
  render() { return this.state.error ? <main role="alert"><h1>Skills</h1><p>{this.state.error}</p><Button onClick={() => location.reload()}>Retry / 重试</Button></main> : this.props.children; }
}
createRoot(document.getElementById('app')!).render(<AppProvider><Boundary><SkillsMarket/></Boundary></AppProvider>);
