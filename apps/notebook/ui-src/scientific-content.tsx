import { useEffect, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import { downloadFile, useAppApi, useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Field, Input, NativeSelect, Textarea } from '@pero/app-sdk/ui';
import { chemicalDerivation, chemicalMolfile, embedReactionMolecule, emptyMolecularGraph, emptyReaction, exportChemical, importChemical, parseReactionDefinition, parseReactionRecord, type ChemicalEmbedding, type ReactionAttributes, type ReactionDefinition, type ReactionMolecule, type ReactionRecord } from '../../../packages/notebook/src/scientific-designs';
import { BlockFrame } from './block-frame';
import { MolecularDrawing, MolecularGraphEditor } from './molecular-graph';
import { scientificError, scientificMessages } from './scientific-ui-shared';

/** Read the mounted node after an awaited operation, never overwrite a newer editor draft. */
function sameDraft(view: NodeViewProps, captured: string): boolean {
  if (view.editor.isDestroyed) return false;
  const position = view.getPos(), node = typeof position === 'number' ? view.editor.state.doc.nodeAt(position) : null;
  return node?.attrs.blockId === view.node.attrs.blockId && JSON.stringify({ reaction: node?.attrs.reaction, record: node?.attrs.record }) === captured;
}

export function ReactionSchemeView(view: NodeViewProps) {
  const { t } = useAppI18n(scientificMessages), api = useAppApi();
  const { reaction, record } = view.node.attrs as ReactionAttributes;
  const [selected, setSelected] = useState(reaction.molecules[0]?.id ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [confirmLoad, setConfirmLoad] = useState(false);
  const alive = useRef(true), pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const molecule = reaction.molecules.find(item => item.id === selected) ?? reaction.molecules[0];
  const editable = view.editor.isEditable;
  const changed = record !== null && JSON.stringify(reaction) !== JSON.stringify(record.definition);
  const change = (next: ReactionDefinition) => { view.updateAttributes({ reaction: next }); setNotice(''); };
  const changeMolecule = (patch: Partial<ReactionMolecule>) => { if (molecule) change({ ...reaction, molecules: reaction.molecules.map(item => item.id === molecule.id ? { ...item, ...patch } : item) }); };
  const save = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    const captured = JSON.stringify({ reaction, record });
    try {
      const definition = parseReactionDefinition(reaction, true);
      const result = await api.post<ReactionRecord>(record ? `/api/scientific/reactions/${record.id}/revisions` : '/api/scientific/reactions', record ? { definition, expectedRevision: record.revision } : { definition });
      if (!alive.current) return;
      const unchanged = sameDraft(view, captured);
      if (unchanged) view.updateAttributes({ record: result });
      setNotice(`${t('saved')}: ${result.id} · v${result.revision}${unchanged ? '' : ` · ${t('changed')}`}`);
    } catch (cause) { if (alive.current) setError(scientificError(cause)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const reload = async () => {
    if (!record || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    const captured = JSON.stringify({ reaction, record });
    try {
      const result = await api.get<ReactionRecord>(`/api/scientific/reactions/${record.id}`);
      if (!alive.current) return;
      if (!sameDraft(view, captured)) throw new Error('The reaction draft changed during loading. Review it before loading again.');
      view.updateAttributes({ reaction: result.definition, record: result }); setSelected(result.definition.molecules[0]?.id ?? ''); setConfirmLoad(false);
    } catch (cause) { if (alive.current) setError(scientificError(cause)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const embed = () => {
    if (!record || !molecule) return;
    const position = view.getPos();
    if (typeof position !== 'number') return;
    view.editor.commands.insertContentAt(position + view.node.nodeSize, { type: 'chemical', attrs: { chemical: embedReactionMolecule(record, molecule.id) } });
  };
  return <BlockFrame view={view} kind="reactionScheme" title={<strong>{reaction.name || t('reactionScheme')}</strong>}>
    <p className="notebook-note">{t('recordScope')}</p>
    <p className="notebook-note">{t('graphLimits')}</p>
    <p role="status">{record ? `${record.id} · v${record.revision} · ${record.savedAt}` : t('draft')}{changed ? ` · ${t('changed')}` : ''}</p>
    <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0 }}>
      <div className="notebook-science-fields">
        <Field label={t('name')}>{control => <Input {...control} disabled={!editable} value={reaction.name} maxLength={200} onChange={e => change({ ...reaction, name: e.target.value })} />}</Field>
        <Field label={t('molecule')}>{control => <NativeSelect {...control} value={molecule?.id ?? ''} onChange={e => setSelected(e.target.value)}><option value="">{t('none')}</option>{reaction.molecules.map((item, index) => <option key={item.id} value={item.id}>{index + 1}: {item.name || t(item.role)}</option>)}</NativeSelect>}</Field>
      </div>
      <div className="notebook-science-actions">
        <Button disabled={!editable || reaction.molecules.length >= 24} onClick={() => { const id = crypto.randomUUID(); change({ ...reaction, molecules: [...reaction.molecules, { id, name: '', role: reaction.molecules.length ? 'product' : 'reactant', graph: emptyMolecularGraph() }] }); setSelected(id); }}>{t('addMolecule')}</Button>
        <Button disabled={!editable || !molecule} onClick={() => { change({ ...reaction, molecules: reaction.molecules.filter(item => item.id !== molecule?.id) }); setSelected(''); }}>{t('removeMolecule')}</Button>
      </div>
      {molecule && <div>
        <div className="notebook-science-fields">
          <Field label={t('molecule') + ' ' + t('name')}>{control => <Input {...control} disabled={!editable} value={molecule.name} maxLength={200} onChange={e => changeMolecule({ name: e.target.value })} />}</Field>
          <Field label={t('role')}>{control => <NativeSelect {...control} disabled={!editable} value={molecule.role} onChange={e => changeMolecule({ role: e.target.value as ReactionMolecule['role'] })}>{(['reactant', 'product', 'agent'] as const).map(role => <option value={role} key={role}>{t(role)}</option>)}</NativeSelect>}</Field>
        </div>
        {editable ? <MolecularGraphEditor key={molecule.id} graph={molecule.graph} disabled={busy} onChange={graph => changeMolecule({ graph })} /> : <MolecularDrawing graph={molecule.graph} />}
      </div>}
      <Field label={t('notes')}>{control => <Textarea {...control} disabled={!editable} value={reaction.notes} maxLength={4000} onChange={e => change({ ...reaction, notes: e.target.value })} />}</Field>
    </fieldset>
    {editable && <div className="notebook-science-actions">
      <Button variant="primary" disabled={busy || record !== null && !changed} onClick={() => void save()}>{busy ? t('requestPending') : t(record ? 'nextRevision' : 'submit')}</Button>
      {record && <Button disabled={busy} onClick={() => setConfirmLoad(true)}>{t('reloadRecord')}</Button>}
      <Button disabled={busy || !record || changed || !molecule} onClick={embed}>{t('embed')}</Button>
    </div>}
    {confirmLoad && <div><p>{t('reloadWarning')}</p><Button disabled={busy} onClick={() => void reload()}>{t('reloadRecord')}</Button><Button onClick={() => setConfirmLoad(false)}>{t('cancel')}</Button></div>}
    {error && <Feedback kind="error">{error}</Feedback>}{notice && <Feedback kind="success">{notice}</Feedback>}
  </BlockFrame>;
}

export function ChemicalView(view: NodeViewProps) {
  const { t } = useAppI18n(scientificMessages), api = useAppApi();
  const chemical = view.node.attrs.chemical as ChemicalEmbedding;
  const [error, setError] = useState('');
  const [sourceRecord, setSourceRecord] = useState<{ key: string; record: ReactionRecord | null }>({ key: '', record: null });
  const [sourceCheck, setSourceCheck] = useState(0);
  const sourceKey = JSON.stringify(chemical.source);
  useEffect(() => {
    let current = true;
    setSourceRecord({ key: sourceKey, record: null });
    const source = chemical.source;
    if (source && /^[a-f0-9]{32}$/.test(source.id)) {
      void api.get<unknown>(`/api/scientific/reactions/${source.id}?revision=${source.revision}`).then(raw => {
        const record = parseReactionRecord(raw);
        if (current) setSourceRecord({ key: sourceKey, record });
      }).catch(() => { /* Unavailable, invalid or absent owners leave portable provenance unverified. */ });
    }
    return () => { current = false; };
  }, [api, sourceKey, sourceCheck]);
  const derivation = chemicalDerivation(chemical, sourceRecord.key === sourceKey ? sourceRecord.record : null);
  const input = useRef<HTMLInputElement>(null), pending = useRef(false);
  const editable = view.editor.isEditable;
  const update = (next: ChemicalEmbedding) => view.updateAttributes({ chemical: next });
  const download = (format: 'mol' | 'json') => {
    setError('');
    try { downloadFile(`chemical.${format}`, new TextEncoder().encode(format === 'mol' ? chemicalMolfile(chemical) : exportChemical(chemical)), format === 'mol' ? 'chemical/x-mdl-molfile' : 'application/json'); }
    catch (cause) { setError(scientificError(cause)); }
  };
  const importFile = async (file: File | undefined) => {
    if (!file || pending.current) return;
    const original = JSON.stringify(chemical);
    pending.current = true; setError('');
    try {
      if (file.size > 262144) throw new Error('Chemical JSON exceeds 256 KiB.');
      const next = importChemical(await file.text());
      const position = view.getPos(), node = typeof position === 'number' && !view.editor.isDestroyed ? view.editor.state.doc.nodeAt(position) : null;
      if (!node || node.attrs.blockId !== view.node.attrs.blockId || JSON.stringify(node.attrs.chemical) !== original) throw new Error('Chemical changed during import. Choose the file again after reviewing this draft.');
      update(next);
    } catch (cause) { if (!view.editor.isDestroyed) setError(scientificError(cause)); }
    finally { pending.current = false; if (input.current) input.current.value = ''; }
  };
  return <BlockFrame view={view} kind="chemical" title={<strong>{chemical.name || t('chemical')}</strong>}>
    <p className="notebook-note">{t('graphLimits')}</p>
    <p role="status">{t(derivation)}{chemical.source ? ` · ${chemical.source.id} v${chemical.source.revision} · ${chemical.source.moleculeId}` : ''}</p>
    {chemical.source && <><p className="notebook-note">{t('provenance')}</p><Button onClick={() => setSourceCheck(value => value + 1)}>{t('checkSource')}</Button></>}
    <Field label={t('name')}>{control => <Input {...control} disabled={!editable} value={chemical.name} maxLength={200} onChange={e => update({ ...chemical, name: e.target.value })} />}</Field>
    {editable ? <MolecularGraphEditor graph={chemical.graph} onChange={graph => update({ ...chemical, graph })} /> : <MolecularDrawing graph={chemical.graph} />}
    <div className="notebook-science-actions">
      <Button onClick={() => download('json')}>{t('json')}</Button><Button onClick={() => download('mol')}>{t('mol')}</Button>
      {editable && <><Button onClick={() => input.current?.click()}>{t('importJson')}</Button><input ref={input} type="file" accept=".json,application/json" aria-label={t('importLabel')} hidden onChange={e => void importFile(e.target.files?.[0])} /></>}
    </div>
    {error && <Feedback kind="error">{error}</Feedback>}
  </BlockFrame>;
}

export function NotebookScientificContentTools({ onInsert }: { onInsert(nodes: JSONContent[]): boolean }) {
  const { t } = useAppI18n(scientificMessages), api = useAppApi();
  const [records, setRecords] = useState<ReactionRecord[]>([]), [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <div className="notebook-science-actions">
    <Button onClick={() => onInsert([{ type: 'reactionScheme', attrs: { reaction: emptyReaction(), record: null } }])}>{t('addReaction')}</Button>
    <Button onClick={() => onInsert([{ type: 'chemical', attrs: { chemical: { name: '', graph: emptyMolecularGraph(), source: null } } }])}>{t('addChemical')}</Button>
    <Button disabled={busy} onClick={() => { setBusy(true); setError(''); void api.get<{ records: ReactionRecord[] }>('/api/scientific/reactions').then(result => setRecords(result.records)).catch(cause => setError(scientificError(cause))).finally(() => setBusy(false)); }}>{t('reloadRecord')}</Button>
    {records.length > 0 && <><NativeSelect aria-label={t('saved')} value={selected} onChange={e => setSelected(e.target.value)}><option value="">{t('none')}</option>{records.map(record => <option key={record.id} value={record.id}>{record.definition.name} · v{record.revision}</option>)}</NativeSelect><Button disabled={!selected} onClick={() => { const record = records.find(item => item.id === selected); if (record) onInsert([{ type: 'reactionScheme', attrs: { reaction: structuredClone(record.definition), record } }]); }}>{t('addReaction')}</Button></>}
    {error && <Feedback kind="error">{error}</Feedback>}
  </div>;
}
