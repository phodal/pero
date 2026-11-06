import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../components/button';
import { Input } from '../components/input';
import { Select } from '../components/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/tabs';
import { ToggleGroup, ToggleGroupItem } from '../components/toggle-group';
import { Table } from '../components/table';
import { Feedback } from '../components/feedback';
import { EmptyState } from '../components/empty-state';
import { EmptyIllustration } from '../components/empty-illustration';
import { Card } from '../components/card';
import { Dialog } from '../components/dialog';
import { Badge } from '../../../pero-design/src/components';
import { METHODS, METHOD_IDS, OBSERVATION_MAX_AGE_MS, observationState, requirementText, filterMethods } from './model.mjs';
import { createInspectionSession, type InspectEnvironment } from './client.mjs';
import type { InspectionRecord, EnvironmentObservation } from './model.mjs';
import { messages } from './messages.mjs';
import type { EnvironmentViewOptions, ScientificMethod } from './view.mjs';

export interface InspectionProps extends EnvironmentViewOptions {
  inspect?: InspectEnvironment;
  now?: () => number;
  embedded?: boolean;
}
const tones = { matched: 'success', blocked: 'warning', stale: 'warning', checking: 'info', error: 'error', unchecked: 'neutral' } as const;

/** Keeps observation lifetime separate from the manager's preparation polling. */
export function EnvironmentChecks({ targets = METHOD_IDS, locale = 'en', selected: initialSelected, single, autoInspect, inspect, now = Date.now, embedded }: InspectionProps) {
  if (!targets.length || targets.some(id => !METHOD_IDS.includes(id)) || (initialSelected && !targets.includes(initialSelected))) throw Error('Unknown scientific method');
  const t = messages(locale), [records, setRecords] = useState<Record<string, InspectionRecord>>({});
  const session = useRef<ReturnType<typeof createInspectionSession> | null>(null);
  const [selected, setSelected] = useState(initialSelected ?? ''), [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [layout, setLayout] = useState('table'), [tab, setTab] = useState('software'), [allBusy, setAllBusy] = useState(false), [clock, tick] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null), previousSelected = useRef(selected), scope = targets.join('|');
  useEffect(() => {
    const value = createInspectionSession({ inspect, changed: next => setRecords({ ...next }) });
    session.current = value; setRecords({});
    setSelected(current => targets.includes(current as ScientificMethod) ? current : initialSelected ?? '');
    if (autoInspect && initialSelected) void value.check(initialSelected);
    return () => { value.dispose(); session.current = null; };
  }, [scope, inspect]);
  useEffect(() => {
    if (previousSelected.current !== selected) heading.current?.focus({ preventScroll: true });
    previousSelected.current = selected;
  }, [selected]);
  useEffect(() => {
    const current = now();
    const next = Object.values(records).flatMap(record => record.report ? [record.report.observed_at_ms > current ? record.report.observed_at_ms : record.report.observed_at_ms + OBSERVATION_MAX_AGE_MS + 1] : []).filter(at => at > current);
    if (!next.length) return;
    const timer = setTimeout(() => tick(value => value + 1), Math.min(2147483647, Math.min(...next) - current));
    return () => clearTimeout(timer);
  }, [records, now, clock]);
  function state(id: string) {
    const record = records[id];
    return record?.state === 'loading' ? 'checking' : record?.state === 'error' ? 'error' : observationState(record?.report, now());
  }
  const badge = (id: string) => <Badge tone={tones[state(id)]}>{t[state(id)]}</Badge>;
  const check = (id: ScientificMethod) => {
    const current = records[id]?.state, label = current === 'loading' ? t.checking : current === 'error' ? t.retry : t.check;
    return <Button busy={current === 'loading'} aria-label={`${label}: ${METHODS.find(item => item.id === id)!.name}`} onClick={() => void session.current?.check(id)}>{label}</Button>;
  };
  const checkAll = async () => {
    setAllBusy(true);
    try { for (const id of targets) await session.current?.check(id); }
    finally { setAllBusy(false); }
  };
  const exportReport = (report: EnvironmentObservation) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `environment-${selected}-${report.observed_at_ms}.json`;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const methods = filterMethods(targets, query, filter, records, now());
  const method = METHODS.find(item => item.id === selected), record = records[selected], report = record?.report;
  const observed = report?.profile.observation;
  const software: { name: string; version: string; missing: boolean }[] = observed ? [
    ...Object.entries(observed.packages).map(([name, version]) => ({ name, version: String(version ?? t.missing), missing: version === null })),
    ...Object.entries(observed.native).map(([name, value]) => ({ name, version: value.status === 'observed' ? value.version ?? t.missing : t[value.status] || value.status, missing: value.status !== 'observed' })),
  ] : [];
  return <section className="pero-env env-inspection">
    {!method ? <>
      <header className="env-heading">{!embedded && <h1>{t.title}</h1>}<Button variant="primary" busy={allBusy} onClick={() => void checkAll()}>{t.checkAll}</Button></header>
      <div className="env-toolbar">
        <Input type="search" aria-label={t.search} placeholder={t.search} value={query} onChange={event => setQuery(event.target.value)} />
        <Select label={t.filter} value={filter} onChange={setFilter} options={['all', 'unchecked', 'matched', 'blocked', 'stale', 'error'].map(value => ({ value, label: t[value] }))} />
        <ToggleGroup type="single" value={layout} onValueChange={next => { if (next) setLayout(next); }} aria-label={t.view}>
          <ToggleGroupItem value="table">{t.table}</ToggleGroupItem><ToggleGroupItem value="grid">{t.grid}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {!methods.length ? <EmptyState icon={<EmptyIllustration kind="search" size="compact" />} description={t.empty} actions={<Button onClick={() => { setQuery(''); setFilter('all'); }}>{t.clear}</Button>} />
        : layout === 'table' ? <Table label={t.title} density="compact" rows={methods} rowId={item => item.id} columns={[
          { id: 'method', header: t.method, size: 210, cell: item => <><Button variant="ghost" onClick={() => { setSelected(item.id); setTab('software'); }}>{item.name}</Button><small className="env-muted">{item.software}</small></> },
          { id: 'app', header: t.app, size: 110, cell: item => item.app },
          { id: 'state', header: t.status, size: 170, cell: item => badge(item.id) },
          { id: 'actions', header: t.actions, size: 110, cell: item => check(item.id) },
        ]} /> : <div className="env-grid">{methods.map(item => <Card key={item.id} className="env-tile" tone="blue" variant="soft">
          <Button variant="ghost" onClick={() => { setSelected(item.id); setTab('software'); }}>{item.name}</Button><p className="env-muted">{item.software}</p>{badge(item.id)}<footer><span className="env-muted">{item.app}</span>{check(item.id)}</footer>
        </Card>)}</div>}
      <p className="env-note">{t.noChanges}</p>
      {targets.filter(id => records[id]?.state === 'error').map(id => <Feedback key={id} kind="error" variant="block">{METHODS.find(item => item.id === id)!.name}: {records[id].error}{records[id].report && ` ${t.retained}`}</Feedback>)}
    </> : <>
      <header className="env-heading"><div className="env-heading-start">{!single && <Button onClick={() => setSelected('')}>{t.back}</Button>}<h2 ref={heading} tabIndex={-1}>{method.name}</h2>{badge(selected)}</div>{check(method.id)}</header>
      <p className="env-subtitle">{method.app} / {t.local}</p>
      {record?.state === 'loading' && <Feedback>{report ? t.refreshing : t.checking}</Feedback>}
      {record?.state === 'error' && <Feedback kind="error" variant="block">{record.error}{report && ` ${t.retained}`}</Feedback>}
      {!report ? record?.state !== 'loading' && record?.state !== 'error' && <EmptyState heading={t.unknown} description={t.checkPrompt} /> : <>
        <dl className="env-facts">{[[t.python, `${observed!.python.major}.${observed!.python.minor}.${observed!.python.patch}`], [t.platform, `${observed!.system} / ${observed!.machine}`], [t.observed, new Date(report.observed_at_ms).toLocaleString(locale)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {observationState(report, now()) === 'stale' && <Feedback kind="warning" variant="block">{t.expired}</Feedback>}
        {!!report.missing.length && <section aria-label={t.blocked}><Feedback kind="warning" variant="block">{t.blocked}. {t.missingNote}</Feedback><ul className="env-requirements">{report.missing.map((item, index) => <li key={index}>{requirementText(item)}</li>)}</ul></section>}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label={t.details}>{['software', 'requirements', 'observation'].map(key => <TabsTrigger key={key} value={key}>{t[key]}</TabsTrigger>)}</TabsList>
          <TabsContent value="software"><Table label={t.software} density="compact" rows={software} rowId={item => item.name} columns={[
            { id: 'name', header: t.package, size: 220, cell: item => item.name },
            { id: 'version', header: t.version, size: 190, cell: item => <span className={item.missing ? 'env-missing' : undefined}>{item.version}</span> },
          ]} /></TabsContent>
          <TabsContent value="requirements"><ul className="env-requirements">{report.requirements.required.map((item, index) => <li key={index}>{requirementText(item)}</li>)}</ul></TabsContent>
          <TabsContent value="observation"><dl className="env-observation"><dt>{t.identity}</dt><dd>{report.profile.id}</dd><dt>{t.evidence}</dt><dd>{t.metadata}</dd></dl><details><summary>JSON</summary><pre className="env-json">{JSON.stringify(report, null, 2)}</pre></details></TabsContent>
        </Tabs>
        <footer className="env-footer"><p className="env-note">{t.scope}</p><Button onClick={() => exportReport(report)}>{t.export}</Button></footer>
      </>}
    </>}
  </section>;
}

export function EnvironmentInspectorAction(props: InspectionProps) {
  const [open, setOpen] = useState(false), t = messages(props.locale);
  const targets = props.targets ?? METHOD_IDS;
  return <span className="pero-env-trigger"><Button aria-haspopup="dialog" onClick={() => setOpen(true)}>{t.inspect}</Button>
    {open && <Dialog title={t.title} closeLabel={t.close} onClose={() => setOpen(false)} className="pero-env-dialog" initialFocus=".pero-ui-dialog-close"><EnvironmentChecks {...props} targets={targets} selected={targets.length === 1 ? targets[0] : undefined} single={targets.length === 1} autoInspect={targets.length === 1} /></Dialog>}
  </span>;
}
