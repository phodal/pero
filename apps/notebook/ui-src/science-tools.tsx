import { FormulaSandboxPanel } from './formula-sandbox';
import { useRef, useState } from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Feedback, Field, Icon, IconButton, NativeSelect } from '@pero/app-sdk/ui';
import { ChemistryPanel, SequencePanel } from './science-tools-calculations';
import { PlatePanel } from './science-tools-plate';
import { CandidateReviewPanel, RecordedChecksPanel } from './science-tools-review';
import { scienceMessages, scienceSnapshotNodes } from './science-tools-shared';
import { worksheetBlocks } from './worksheet-model';
import type { masterMixExample } from '@pero/notebook/research-tools';

const toolNames = ['formula', 'review', 'sequence', 'chemistry', 'plate', 'checks', 'capabilities'] as const;
type Tool = typeof toolNames[number];

export function NotebookScienceTools({ editor, onInsert, initial = 'review', label, className, caret = false }: { editor: Editor; onInsert(nodes: JSONContent[]): void; initial?: Tool; label?: string; className?: string; caret?: boolean }) {
  const { t } = useAppI18n(scienceMessages);
  const [open, setOpen] = useState(false), [tool, setTool] = useState<Tool>('review'), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [showLimits, setShowLimits] = useState(false);
  const limitsTrigger = useRef<HTMLButtonElement>(null);
  const base = useRef(''), lastInserted = useRef('');
  const insertSnapshot = (snapshot: unknown, nodes: JSONContent[]) => {
    if (editor.isDestroyed || !editor.isEditable || JSON.stringify(editor.getJSON()) !== base.current) { setError(t('stale')); return false; }
    const signature = JSON.stringify(snapshot);
    if (signature === lastInserted.current) { setError(t('duplicate')); return false; }
    const before = JSON.stringify(editor.getJSON());
    onInsert(nodes);
    const after = JSON.stringify(editor.getJSON());
    if (after === before) { setError(t('failure')); return false; }
    base.current = after; lastInserted.current = signature; setNotice(t('inserted')); setError(''); return true;
  };
  const onSnapshot = (title: string, snapshot: unknown, rows?: string[][]) => insertSnapshot(snapshot,
    scienceSnapshotNodes(title, snapshot, rows, worksheetBlocks(editor.state.doc).map(sheet => sheet.name)));
  const onInsertExample = (example: ReturnType<typeof masterMixExample>) => {
    const existing = new Set(worksheetBlocks(editor.state.doc).map(sheet => sheet.name.toLowerCase()));
    let name = example.worksheet.name, suffix = 2;
    while (existing.has(name.toLowerCase())) name = `${example.worksheet.name} ${suffix++}`;
    const mixture = structuredClone(example.mixture);
    for (const recipe of [mixture.draft, ...mixture.recipes.map(revision => revision.recipe)]) for (const ingredient of recipe.ingredients) {
      if (ingredient.source.startsWith(example.worksheet.name + '!')) ingredient.source = name + ingredient.source.slice(example.worksheet.name.length);
    }
    return insertSnapshot(example, [
      { type: 'spreadsheet', attrs: { label: name, sheet: example.worksheet.sheet, annotations: {} } },
      { type: 'mixturePrep', attrs: { label: t('masterMixTitle'), mixture } },
    ]);
  };
  const props = { onSnapshot, getContent: () => JSON.stringify(editor.getJSON()) };
  return <>
    <Button variant="ghost" className={className} disabled={!editor.isEditable} onClick={() => { base.current = JSON.stringify(editor.getJSON()); lastInserted.current = ''; setNotice(''); setError(''); setShowLimits(false); setTool(initial); setOpen(true); }}>{label ?? t('tools')}{caret && <Icon name="chevron-down" size={12} />}</Button>
    {open && <Dialog title={label ?? t('tools')} size="lg" className="notebook-science-dialog" closeLabel={t('close')} onClose={() => { setShowLimits(false); setOpen(false); }} dismissOnBackdrop>
      <div className="notebook-science-tool-picker">
        <Field label={t('tools')}>{control => <NativeSelect {...control} value={tool} onChange={event => { setTool(event.target.value as Tool); setNotice(''); setError(''); }}>{toolNames.map(name => <option key={name} value={name}>{t(name)}</option>)}</NativeSelect>}</Field>
        <IconButton ref={limitsTrigger} label={t('limits')} onClick={() => setShowLimits(true)}><Icon name="info" /></IconButton>
      </div>
      {showLimits && <Dialog size="sm" title={t('limits')} closeLabel={t('close')} restoreFocus={false} onClose={() => {
        setShowLimits(false);
        requestAnimationFrame(() => limitsTrigger.current?.focus());
      }}><p>{t('scope')}</p></Dialog>}
      {notice && <Feedback kind="success">{notice}</Feedback>}{error && <Feedback kind="error">{error}</Feedback>}
      <div key={tool} className="notebook-science-content">
        {tool === 'formula' ? <FormulaSandboxPanel worksheets={worksheetBlocks(editor.state.doc)} onSnapshot={onSnapshot} onInsertExample={onInsertExample} /> : tool === 'sequence' ? <SequencePanel {...props} /> : tool === 'chemistry' ? <ChemistryPanel {...props} /> : tool === 'plate' ? <PlatePanel {...props} /> : tool === 'checks' ? <RecordedChecksPanel {...props} /> : tool === 'review' ? <CandidateReviewPanel {...props} /> : <div className="notebook-science-panel">
          <h3>{t('capabilities')}</h3>
          <dl>
            <dt>{t('sequence')}</dt><dd>{t('sequenceLimits')}</dd>
            <dt>{t('chemistry')}</dt><dd>{t('chemistryLimits')}</dd>
            <dt>{t('plate')}</dt><dd>24 / 96 / 384 / 1536. {t('plateHint')}</dd>
            <dt>{t('review')}</dt><dd>{t('reviewLimits')}</dd>
            <dt>{t('checks')}</dt><dd>{t('checksLimits')}</dd>
          </dl>
          <p className="notebook-note">{t('methodVersions')}</p>
          <p className="notebook-note">{t('inventories')}</p>
          <a href="https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi" target="_blank" rel="noreferrer">{t('ncbiTables')}</a>
        </div>}
      </div>
    </Dialog>}
  </>;
}
