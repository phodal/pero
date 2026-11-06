import { useRef, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Feedback, Field, Input } from '@pero/app-sdk/ui';
import { messages, type Cluster, type ClusterInput } from './messages';

export function ClusterDialog({ cluster, busy, error, onClose, onSave }: {
  cluster: Cluster | null; busy: boolean; error: string; onClose(): void; onSave(value: ClusterInput): void;
}) {
  const { t } = useAppI18n(messages), form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<ClusterInput>(() => cluster
    ? { id: cluster.id, name: cluster.name, host: cluster.host, account: cluster.account, partition: cluster.partition, workdir: cluster.workdir }
    : { name: '', host: '', account: '', partition: '', workdir: '' });
  const save = () => { if (!busy && form.current?.reportValidity()) onSave(draft); };
  return <Dialog title={t(cluster ? 'editTitle' : 'createTitle')} closeLabel={t('close')} onClose={() => { if (!busy) onClose(); }}
    footer={<><Button disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button variant="primary" busy={busy} onClick={save}>{t(busy ? 'saving' : 'save')}</Button></>}>
    <p className="compute-help">{t('configurationHelp')}</p>
    <form className="compute-fields" ref={form} onSubmit={event => { event.preventDefault(); save(); }} onKeyDown={event => {
      if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement) || event.defaultPrevented
        || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      // Apps are embedded without allow-forms; use the same explicit save path.
      event.preventDefault(); if (!event.repeat) save();
    }}>
      {(['name', 'host', 'account', 'partition', 'workdir'] as const).map(name => <Field key={name} label={t(name)} description={name === 'account' || name === 'partition' || name === 'workdir' ? t('optional') : undefined}>
        {control => <Input {...control} name={name} required={name === 'name' || name === 'host'} autoComplete="off"
          maxLength={name === 'workdir' ? 1024 : name === 'host' ? 255 : 120} value={draft[name]} disabled={busy}
          onChange={event => setDraft(value => ({ ...value, [name]: event.target.value }))} />}
      </Field>)}
    </form>
    {error ? <Feedback kind="error" variant="block">{t('actionFailed')}</Feedback> : null}
    {error ? <details className="compute-error-details"><summary>{t('details')}</summary><p>{error}</p></details> : null}
  </Dialog>;
}
