import { useEffect, useRef, useState } from 'react';
import { useAppApi, useAppI18n, useAppInfo } from '@pero/app-sdk';
import { Button, Disclosure, EmptyState, Feedback, Field, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger, Toolbar } from '@pero/app-sdk/ui';
import exampleBrief from '../examples/brief.json';
import { messages } from './messages';
import { latestReport, projectBrief, type Card, type Edition, type Home } from './project';
import css from './styles.css';

const sample = exampleBrief as Edition;

function kindLabel(kind: string, t: (key: keyof typeof messages) => string) {
  const key = `kind_${kind}` as keyof typeof messages;
  return key in messages ? t(key) : kind;
}

export default function Pulse() {
  const { t } = useAppI18n(messages);
  const { active } = useAppInfo();
  const api = useAppApi();
  const file = useRef<HTMLInputElement>(null);
  const seenKey = useRef('');
  const [home, setHome] = useState<Home | null>(null);
  const [opened, setOpened] = useState<Edition | null>(null);
  const [selected, setSelected] = useState('');
  const [view, setView] = useState('brief');
  const [filteredOpen, setFilteredOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [watchText, setWatchText] = useState('');
  const [cadence, setCadence] = useState('brief');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState('');

  function fail(reason: unknown) {
    const code = reason instanceof Error ? reason.message : String(reason);
    setError(code in messages ? t(code as keyof typeof messages) : code);
  }
  async function run(work: () => Promise<Home>) {
    setBusy(true); setError('');
    try { setHome(await work()); return true; }
    catch (reason) { fail(reason); return false; }
    finally { setBusy(false); }
  }
  async function refresh() { await run(() => api.get<Home>('/api/home')); }

  useEffect(() => { void refresh(); }, []);
  const editions = home && opened && !home.editions.some(edition => edition.id === opened.id) ? [opened, ...home.editions] : home?.editions ?? [];
  const brief = projectBrief(editions, selected);
  useEffect(() => {
    if (!active || view !== 'brief' || !brief.current || !brief.attention) return;
    const key = `${brief.current.id}:${brief.needsYou.filter(card => !card.seen).map(card => card.id).join(',')}`;
    if (seenKey.current === key) return;
    seenKey.current = key;
    void api.post<Home>('/api/seen', { cards: brief.needsYou.filter(card => !card.seen).map(card => ({ edition: brief.current!.id, card: card.id })) })
      .then(setHome)
      .catch(reason => { seenKey.current = ''; fail(reason); });
  }, [active, view, brief.current?.id, brief.attention, home]);

  async function importFile(picked: File) {
    try {
      const edition = JSON.parse(await picked.text()) as Edition;
      if (await run(() => api.post<Home>('/api/editions', edition))) { setSelected(edition.id || ''); setView('brief'); }
    } catch (reason) { setError(reason instanceof SyntaxError ? t('invalidFile') : reason instanceof Error && reason.message in messages ? t(reason.message as keyof typeof messages) : t('invalidFile')); }
  }
  async function openArchive(id: string) {
    setBusy(true); setError('');
    try {
      const edition = await api.get<Edition>(`/api/editions/${id}`);
      setOpened(edition); setSelected(id); setView('brief');
    } catch (reason) { fail(reason); }
    finally { setBusy(false); }
  }
  function saveWatch() {
    const text = watchText.trim();
    if (!text || busy) return;
    void run(() => api.post<Home>('/api/watches', { text, cadence })).then(saved => { if (saved) setWatchText(''); });
  }

  const cadenceOptions = [
    { value: 'brief', label: t('briefCadence') }, { value: 'hourly', label: t('hourly') },
    { value: 'daily', label: t('dailyCadence') }, { value: 'weekday', label: t('weekday') },
  ];
  const levels = [
    { value: 'off', label: t('off') }, { value: 'decisions', label: t('decisions') },
    { value: 'brief', label: t('briefLevel') }, { value: 'active', label: t('active') },
  ];

  return <section className="pulse" aria-label="Pulse" aria-busy={busy}><style>{css}</style>
    <input className="pulse-file" ref={file} type="file" accept="application/json,.json" aria-label={t('import')} onChange={event => { const picked = event.target.files?.[0]; event.target.value = ''; if (picked) void importFile(picked); }}/>
    {error && <Feedback kind="error">{error} <Button disabled={busy} onClick={() => void refresh()}>{t('retry')}</Button></Feedback>}
    {busy && !home && <Feedback>{t('busy')}</Feedback>}
    {home && <Tabs value={view} onValueChange={setView}>
      <Toolbar className="pulse-toolbar" actions={<>
        <Button disabled={busy} onClick={() => file.current?.click()}>{t('import')}</Button>
        <Button disabled={busy} onClick={() => void run(() => api.post<Home>('/api/editions', sample)).then(saved => { if (saved) { setSelected(sample.id); setView('brief'); } })}>{t('example')}</Button>
        <Button disabled={busy} onClick={() => void refresh()}>{t('refresh')}</Button>
      </>}>
        <TabsList aria-label="Pulse">
          <TabsTrigger value="brief">{t('brief')}{brief.attention ? ` ${brief.attention}` : ''}</TabsTrigger>
          <TabsTrigger value="activity">{t('activity')}</TabsTrigger>
          <TabsTrigger value="watches">{t('watches')}</TabsTrigger>
        </TabsList>
      </Toolbar>
      <TabsContent value="brief"><div className="pulse-column">
        {!brief.current && <EmptyState heading={t('empty')} description={t('emptyNext')}/>}
        {brief.current && <>
          <p className="pulse-meta">{brief.current.goalId ? (home.watches.find(watch => watch.id === brief.current?.goalId)?.text ?? t('watchReport')) : t('daily')} · <time dateTime={brief.current.createdAt}>{brief.current.createdAt}</time></p>
          {!!brief.needsYou.length && <h2>{t('attention').replace('{n}', String(brief.needsYou.length))}</h2>}
          {brief.needsYou.map(card => <CardView key={card.id} card={card} edition={brief.current!.id} t={t} note={notes[`${brief.current!.id}/${card.id}`] ?? ''} busy={busy} onNote={value => setNotes(prev => ({ ...prev, [`${brief.current!.id}/${card.id}`]: value }))} onAct={(path, body) => run(() => api.post<Home>(path, body))}/>)}
          {brief.cards.map(card => <CardView key={card.id} card={card} edition={brief.current!.id} t={t} note={notes[`${brief.current!.id}/${card.id}`] ?? ''} busy={busy} onNote={value => setNotes(prev => ({ ...prev, [`${brief.current!.id}/${card.id}`]: value }))} onAct={(path, body) => run(() => api.post<Home>(path, body))}/>)}
          {!!brief.filtered.length && <Button onClick={() => setFilteredOpen(open => !open)}>{(filteredOpen ? t('hideFiltered') : t('filtered')).replace('{n}', String(brief.filtered.length))}</Button>}
          {filteredOpen && brief.filtered.map(card => <CardView key={card.id} card={card} edition={brief.current!.id} t={t} note={notes[`${brief.current!.id}/${card.id}`] ?? ''} busy={busy} onNote={value => setNotes(prev => ({ ...prev, [`${brief.current!.id}/${card.id}`]: value }))} onAct={(path, body) => run(() => api.post<Home>(path, body))}/>)}
          {!brief.needsYou.length && !brief.cards.length && !brief.filtered.length && !brief.current.tomorrow && <p className="pulse-muted">{t('quiet')}</p>}
          {brief.current.tomorrow && <section><h2>{t('next')}</h2><p>{brief.current.tomorrow}</p></section>}
        </>}
      </div></TabsContent>
      <TabsContent value="activity"><div className="pulse-column">
        {!home.editions.length && !home.archive.length && <EmptyState heading={t('activityEmpty')} description={t('activityNext')}/>}
        <div className="pulse-list">{home.editions.map(edition => <button key={edition.id} type="button" className="pulse-row" onClick={() => { setSelected(edition.id); setView('brief'); }}><strong>{edition.cards[0]?.title || t('untitled')}</strong><span className="pulse-meta">{edition.createdAt}</span></button>)}</div>
        {!!home.archive.length && <><h2>{t('archive')}</h2><div className="pulse-list">{home.archive.map(item => <button key={item.id} type="button" className="pulse-row" onClick={() => void openArchive(item.id)}><strong>{item.id}</strong><span className="pulse-meta">{item.createdAt} · {item.cards}</span></button>)}</div></>}
      </div></TabsContent>
      <TabsContent value="watches"><div className="pulse-column">
        <div className="pulse-form">
          <Field label={t('watchText')}>{({ id }) => <Input id={id} value={watchText} maxLength={500} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); saveWatch(); } }} onChange={event => setWatchText(event.target.value)}/>}</Field>
          <Select label={t('cadence')} value={cadence} options={cadenceOptions} onChange={setCadence}/>
          <Button variant="primary" disabled={busy || !watchText.trim()} onClick={saveWatch}>{t('addWatch')}</Button>
        </div>
        <Select label={t('proactivity')} value={home.proactivity} options={levels} disabled={busy} onChange={value => void run(() => api.post<Home>('/api/proactivity', { value }))}/>
        {!home.watches.length && <EmptyState heading={t('watchEmpty')} description={t('watchNext')}/>}
        {home.watches.map(watch => {
          const report = latestReport(home.editions, watch.id);
          return <article key={watch.id} className="pulse-card"><header><strong>{watch.text}</strong><span className="pulse-tag">{cadenceOptions.find(option => option.value === watch.cadence)?.label}</span></header>
            <p className="pulse-muted">{report ? `${report.createdAt} · ${report.cards[0]?.conclusion ?? t('noReport')}` : t('noReport')}</p>
            <div className="pulse-actions">{confirming === watch.id
              ? <Button disabled={busy} onClick={() => void run(() => api.post<Home>('/api/watches/remove', { id: watch.id })).then(() => setConfirming(''))}>{t('confirmRemove')}</Button>
              : <Button disabled={busy} onClick={() => setConfirming(watch.id)}>{t('remove')}</Button>}
            </div></article>;
        })}
      </div></TabsContent>
    </Tabs>}
  </section>;
}

function CardView({ card, edition, t, note, busy, onNote, onAct }: { card: Card; edition: string; t: (key: keyof typeof messages) => string; note: string; busy: boolean; onNote(value: string): void; onAct(path: string, body: unknown): Promise<boolean> }) {
  const mark = { edition, card: card.id };
  return <article className="pulse-card" data-kind={card.kind}>
    <header><span className="pulse-tag" data-kind={card.kind}>{kindLabel(card.kind, t)}</span>{card.handled && <span className="pulse-tag">{t('handled')}</span>}<strong>{card.title}</strong></header>
    <p>{card.conclusion}</p>
    {card.impact && <p className="pulse-muted">{card.impact}</p>}
    {card.entity && <p>{card.entity.url ? <a href={card.entity.url} target="_blank" rel="noreferrer">{card.entity.label}</a> : card.entity.label}</p>}
    {(card.body || card.why || card.sources?.length) && <Disclosure summary={t('why')}>
      {card.body && <p>{card.body}</p>}
      {card.why && <p>{card.why}</p>}
      {!!card.sources?.length && <ul>{card.sources.map(source => <li key={source.label}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a> : source.label}</li>)}</ul>}
    </Disclosure>}
    <div className="pulse-actions">
      <Button disabled={busy} onClick={() => void onAct('/api/dismissed', { ...mark, dismissed: true })}>{t('dismiss')}</Button>
      <Button disabled={busy} aria-pressed={card.feedback?.vote === 'more'} onClick={() => void onAct('/api/feedback', { ...mark, vote: 'more', note })}>{t('more')}</Button>
      <Button disabled={busy} aria-pressed={card.feedback?.vote === 'less'} onClick={() => void onAct('/api/feedback', { ...mark, vote: 'less', note })}>{t('less')}</Button>
      <Input aria-label={t('note')} value={note} maxLength={300} placeholder={t('note')} onChange={event => onNote(event.target.value)}/>
      {card.feedback && <span className="pulse-muted">{t('noted')}{card.feedback.note ? ` · ${card.feedback.note}` : ''}</span>}
    </div>
  </article>;
}
