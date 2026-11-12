import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LocalEnvironmentRecord, LocalEnvironmentOperation } from '../../../../protocol/generated/host';
import { Button } from '../components/button';
import { Card } from '../components/card';
import { Field } from '../components/field';
import { Input } from '../components/input';
import { Select } from '../components/select';
import { Feedback } from '../components/feedback';
import { EmptyState } from '../components/empty-state';
import { EmptyIllustration } from '../components/empty-illustration';
import { Disclosure } from '../components/disclosure';
import { Dialog } from '../components/dialog';
import { Progress } from '../components/progress';
import { Badge } from '../../../pero-design/src/components';
import { computeMessages } from './compute-messages';
import { ProjectProposal } from './project-proposal';

/** A view of the existing Host catalog: preparing/selecting never dispatches science. */
export function ComputeEnvironments({ locale, fetchFn = globalThis.fetch, pollMs = 1000, onBar }: {
  locale: string; fetchFn?: typeof fetch; pollMs?: number;
  onBar?: (actions: { refresh: () => void; create: () => void; listing: boolean; busy: boolean }) => void;
}) {
  const t = computeMessages(locale);
  const [values, setValues] = useState<LocalEnvironmentRecord[]>([]), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(''), [selected, setSelected] = useState('');
  const [dialog, setDialog] = useState<'create' | 'rebuild' | null>(null), [label, setLabel] = useState(''), [formError, setFormError] = useState('');
  const [target, setTarget] = useState<'control-lab.python-control' | 'paper-agent.pcgym'>('control-lab.python-control');
  const [cancelling, setCancelling] = useState(false);
  const alive = useRef(false), pending = useRef(false), epoch = useRef(0), heading = useRef<HTMLHeadingElement>(null);
  const call = useCallback(async (request: LocalEnvironmentOperation) => {
    const response = await fetchFn('/host/environment/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    if (!response.ok) throw Object.assign(Error((await response.text()).slice(0, 1000)), { status: response.status });
    return await response.json() as LocalEnvironmentRecord[];
  }, [fetchFn]);
  const failure = useCallback((cause: unknown) => {
    if (cause instanceof Error && 'status' in cause && [401, 403, 404, 410].includes(Number(cause.status))) { setValues([]); setLoaded(false); }
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);
  const refresh = useCallback(async () => {
    const version = epoch.current;
    try {
      const result = await call({ operation: 'list', compute: true });
      if (alive.current && version === epoch.current) { setValues(result); setLoaded(true); setError(''); }
    } catch (cause) { if (alive.current && version === epoch.current) failure(cause); }
  }, [call, failure]);
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; epoch.current++; }; }, [refresh]);
  const preparing = busy === 'prepare' || values.some(value => value.state === 'preparing');
  useEffect(() => {
    if (!preparing) return;
    // Reading persisted progress is allowed while the original Prepare request waits.
    let stopped = false, reading = false;
    const timer = setInterval(async () => { if (reading || stopped) return; reading = true; await refresh(); reading = false; }, pollMs);
    return () => { stopped = true; clearInterval(timer); };
  }, [preparing, pollMs, refresh]);
  const mutate = async (request: LocalEnvironmentOperation) => {
    if (pending.current) return;
    pending.current = true; epoch.current++; setBusy(request.operation); setError(''); setFormError('');
    try {
      const result = await call(request);
      if (!alive.current) return;
      epoch.current++; setValues(result); setLoaded(true);
      if (request.operation === 'create_locked' || request.operation === 'rebuild') {
        const created = result.find(value => !values.some(previous => previous.id === value.id));
        if (created) setSelected(created.id);
        setDialog(null); setLabel('');
      }
    } catch (cause) {
      if (alive.current) {
        if (request.operation === 'create_locked' || request.operation === 'rebuild') setFormError(cause instanceof Error ? cause.message : String(cause));
        else failure(cause);
      }
    } finally { pending.current = false; epoch.current++; if (alive.current) setBusy(''); }
  };
  const value = values.find(item => item.id === selected), current = values.filter(item => item.bound);
  const cancelPreparation = async () => {
    if (!value || cancelling) return;
    setCancelling(true);
    try { await call({operation:'cancel',id:value.id}); await refresh(); }
    catch (cause) { failure(cause); }
    finally { if (alive.current) setCancelling(false); }
  };
  const method = (value: LocalEnvironmentRecord) => value.target === 'paper-agent.pcgym' ? 'PC-Gym' : 'Control Lab';
  useEffect(() => { if (selected) heading.current?.focus({ preventScroll: true }); }, [selected]);
  const status = (item: LocalEnvironmentRecord) => <Badge tone={item.state === 'failed' ? 'error' : item.state === 'preparing' ? 'info' : item.state === 'ready' ? 'success' : 'neutral'}>{t[item.state]}</Badge>;
  const open = (kind: 'create' | 'rebuild') => { setFormError(''); if (kind === 'rebuild' && value) setLabel(value.label); setDialog(kind); };
  const publish = useRef(onBar);
  publish.current = onBar;
  useLayoutEffect(() => {
    publish.current?.({ refresh: () => { void refresh(); }, create: () => open('create'), listing: !value, busy: !!busy });
  }, [refresh, value, busy]);
  const submit = (form: HTMLFormElement) => {
    if (!form.reportValidity() || busy) return;
    void mutate(dialog === 'rebuild' && value ? { operation: 'rebuild', id: value.id, label } : { operation: 'create_locked', target, label });
  };
  return <section className="env-compute" aria-label={t.title}>
    {loaded && <Card tone="blue" variant="soft" className="env-recipe-summary">
      <h3>{t.current}</h3>{current.map(item => <div className="env-heading" key={item.id}><p>{method(item)} · {item.label}</p>
        <Button disabled={!!busy || preparing} onClick={() => void mutate({ operation: 'unbind_compute', target: item.target === 'paper-agent.pcgym' ? item.target : 'control-lab.python-control' })}>{t.returnService}</Button></div>)}
      {!current.length && <p className="env-note">{t.noSelection}</p>}<p className="env-note">{t.boundary}</p>
    </Card>}
    <p className="env-note">{t.history}</p>
    <ProjectProposal locale={locale} fetchFn={fetchFn}/>
    {error && <Feedback kind="error" variant="block">{error} {loaded && t.retained} <Button disabled={!!busy} onClick={() => void refresh()}>{t.refresh}</Button></Feedback>}
    {value ? <>
      <Button className="env-back" variant="ghost" onClick={() => setSelected('')}>{t.back}</Button>
      <div className="env-heading"><h2 ref={heading} tabIndex={-1}>{value.label}</h2>{status(value)}</div>
      <dl className="env-facts"><div><dt>{t.source}</dt><dd>{method(value)} · {t.sourceValue}</dd></div><div><dt>{t.python}</dt><dd>{value.prepared?.python_request ?? '3.12.14'}</dd></div><div><dt>{t.manager}</dt><dd>uv {value.prepared?.uv_version ?? '0.12.20'}</dd></div></dl>
      <div className="env-actions">
        {(value.state === 'created' || value.state === 'failed') && <Button variant="primary" busy={busy === 'prepare'} disabled={!!busy || preparing} onClick={() => void mutate({ operation: 'prepare', id: value.id })}>{value.state === 'failed' ? t.retry : t.prepare}</Button>}
        {value.state === 'ready' && (value.bound ? <Badge tone="info">{t.chosen}</Badge> : <Button variant="primary" busy={busy === 'bind_compute'} disabled={!!busy || preparing} onClick={() => void mutate({ operation: 'bind_compute', id: value.id })}>{t.choose}</Button>)}
        {value.prepared && <Button disabled={!!busy || preparing} onClick={() => open('rebuild')}>{t.rebuild}</Button>}
        {value.state === 'preparing' && <Button busy={cancelling} disabled={cancelling} onClick={() => void cancelPreparation()}>{t.cancelPreparation}</Button>}
      </div>
      {value.error && <Feedback kind="error" variant="block">{value.failure && <strong>{t[value.failure.stage]}: </strong>}{value.error}</Feedback>}
      {(value.state === 'preparing' || busy === 'prepare') && <div className="env-preparation-progress"><Progress label={t.preparing}/><Feedback>{value.log.at(-1) || t.starting}</Feedback><p className="env-note">{t.noPercent}</p></div>}
      <p className="env-note">{value.prepared ? t.published : t.recipe}</p>
      {value.prepared && <Disclosure variant="inline" summary={t.evidence}><dl className="env-observation"><dt>{t.lock}</dt><dd>{value.prepared.lock_sha256}</dd><dt>{t.content}</dt><dd>{value.prepared.observation.packages_sha256}</dd><dt>{t.dependencies}</dt><dd>{Object.entries(value.prepared.observation.packages).map(([name, version]) => <div key={name}>{name} {version}</div>)}</dd></dl></Disclosure>}
      {!!value.log.length && <Disclosure variant="inline" summary={t.log}><pre className="env-json">{value.log.join('\n')}</pre></Disclosure>}
    </> : <>
      <div className="env-heading"><div><h2>{t.title}</h2><p className="env-note">{t.about}</p></div>{!onBar && <div className="env-actions"><Button disabled={!!busy} onClick={() => void refresh()}>{t.refresh}</Button>{!!values.length && <Button variant="primary" disabled={!!busy || preparing} onClick={() => open('create')}>{t.create}</Button>}</div>}</div>
      {!loaded ? !error && <Feedback>{t.loading}</Feedback> : !values.length ? <EmptyState icon={<EmptyIllustration kind="environment"/>} heading={t.empty} description={t.emptyNote} actions={onBar ? undefined : <Button variant="primary" disabled={!!busy} onClick={() => open('create')}>{t.create}</Button>}/> : <div className="env-grid">{values.map(item => <Card className="env-tile" key={item.id}>
        <Button variant="link" onClick={() => setSelected(item.id)}>{item.label}</Button><div className="env-actions">{status(item)}{item.bound && <Badge tone="info">{t.chosen}</Badge>}</div><p className="env-note">{method(item)} · Python {item.prepared?.python_request ?? '3.12.14'} · uv</p>
        {item.error && <Feedback kind="error">{item.error}</Feedback>}
      </Card>)}</div>}
    </>}
    {!!busy && busy !== 'prepare' && <Feedback>{t.pending}</Feedback>}
    {dialog && <Dialog title={dialog === 'rebuild' ? t.rebuildTitle : t.create} closeLabel={t.cancel} onClose={() => { if (!busy) setDialog(null); }}>
      <form className="env-create-form" onSubmit={event => { event.preventDefault(); submit(event.currentTarget); }}>
        {dialog === 'create' && <Field label={t.method} controlId="compute-method">{control => <Select {...control} label={t.method} value={target} disabled={!!busy} onChange={value => setTarget(value as typeof target)} options={[{value:'control-lab.python-control',label:'Control Lab'},{value:'paper-agent.pcgym',label:'PC-Gym'}]}/>}</Field>}
        <Field label={t.name} controlId="compute-name">{control => <Input {...control} required maxLength={80} value={label} disabled={!!busy} onChange={event => setLabel(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) submit(event.currentTarget.form!); } }}/>}</Field>
        <p>{dialog === 'rebuild' ? t.rebuildNote : t.recipe}</p>{formError && <Feedback kind="error" variant="block">{formError}</Feedback>}
        <div className="env-form-actions"><Button disabled={!!busy} onClick={() => setDialog(null)}>{t.cancel}</Button><Button type="submit" variant="primary" busy={!!busy} onClick={event => { event.preventDefault(); submit(event.currentTarget.form!); }}>{dialog === 'rebuild' ? t.rebuildAction : t.createAction}</Button></div>
      </form>
    </Dialog>}
  </section>;
}
