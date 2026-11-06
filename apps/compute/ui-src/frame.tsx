import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useAppI18n } from '@pero/app-sdk';
import { Button, Feedback } from '@pero/app-sdk/ui';
import Compute from './index';
import { messages } from './messages';

function Failure({ error }: { error: string }) {
  const { t } = useAppI18n(messages);
  return <main className="compute-recovery"><Feedback kind="error" variant="block">{t('unavailable')}</Feedback>
    <Button onClick={() => location.reload()}>{t('reload')}</Button><details><summary>{t('details')}</summary><p>{error}</p></details></main>;
}
class Boundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <Failure error={this.state.error} /> : this.props.children; }
}
createRoot(document.getElementById('app')!).render(<AppProvider><Boundary><Compute /></Boundary></AppProvider>);
