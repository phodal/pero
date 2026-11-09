import { FormulaSandboxPanel } from './formula-sandbox';
import { NotebookAITools } from './ai-tools';
import type { GenerationTarget, AIApplication } from '@pero/notebook/ai-generation';
import { useRef, useState } from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Feedback, NativeSelect, Field } from '@pero/app-sdk/ui';
import { ChemistryPanel, SequencePanel } from './science-tools-calculations';
import { PlatePanel } from './science-tools-plate';
import { CandidateReviewPanel, RecordedChecksPanel } from './science-tools-review';
import { scienceMessages, scienceSnapshotNodes } from './science-tools-shared';
import { worksheetBlocks } from './worksheet-model';

const toolNames = ['formula', 'ai', 'review', 'sequence', 'chemistry', 'plate', 'checks', 'capabilities'] as const;
type Tool = typeof toolNames[number];

export function NotebookScienceTools({ editor, onInsert, getTarget = () => null }: { editor: Editor; onInsert(nodes: JSONContent[]): void; getTarget?(): GenerationTarget | null }) {
  const { t } = useAppI18n(scienceMessages);
  const [open, setOpen] = useState(false), [tool, setTool] = useState<Tool>('review'), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const base = useRef(''), lastInserted = useRef('');
  const onSnapshot = (title: string, snapshot: unknown, rows?: string[][]) => {
    if (editor.isDestroyed || !editor.isEditable || JSON.stringify(editor.getJSON()) !== base.current) { setError(t('stale')); return false; }
    const signature = JSON.stringify(snapshot);
    if (signature === lastInserted.current) { setError(t('duplicate')); return false; }
    const before = JSON.stringify(editor.getJSON());
    onInsert(scienceSnapshotNodes(title, snapshot, rows, worksheetBlocks(editor.state.doc).map(sheet => sheet.name)));
    const after = JSON.stringify(editor.getJSON());
    if (after === before) { setError(t('failure')); return false; }
    base.current = after; lastInserted.current = signature; setNotice(t('inserted')); setError(''); return true;
  };
  const onApply = (application: AIApplication) => {
    if (editor.isDestroyed || !editor.isEditable || JSON.stringify(editor.getJSON()) !== application.baseContent) {
      setError(t('stale')); return false;
    }
    const content = JSON.parse(application.content) as JSONContent;
    content.content = [...(content.content ?? []), ...scienceSnapshotNodes('AI cell review', application.evidence)];
    const changed = editor.commands.setContent(content, { errorOnInvalidContent: true });
    if (!changed) { setError(t('failure')); return false; }
    base.current = JSON.stringify(editor.getJSON()); setNotice(t('inserted')); setError(''); return true;
  };
  const props = { onSnapshot, getContent: () => JSON.stringify(editor.getJSON()) };
  return <>
    <Button variant="ghost" disabled={!editor.isEditable} onClick={() => { base.current = JSON.stringify(editor.getJSON()); lastInserted.current = ''; setNotice(''); setError(''); setOpen(true); }}>{t('tools')}</Button>
    {open && <Dialog title={t('tools')} size="lg" className="notebook-science-dialog" closeLabel={t('close')} onClose={() => setOpen(false)} dismissOnBackdrop>
      <p className="notebook-note">{t('scope')}</p>
      <Field label={t('tools')}>{control => <NativeSelect {...control} value={tool} onChange={event => { setTool(event.target.value as Tool); setNotice(''); setError(''); }}>{toolNames.map(name => <option key={name} value={name}>{t(name)}</option>)}</NativeSelect>}</Field>
      {notice && <Feedback kind="success">{notice}</Feedback>}{error && <Feedback kind="error">{error}</Feedback>}
      <div key={tool} className="notebook-science-content">
        {tool === 'formula' ? <FormulaSandboxPanel worksheets={worksheetBlocks(editor.state.doc)} onSnapshot={onSnapshot} /> : tool === 'ai' ? <NotebookAITools key={getTarget()?.entryId ?? "unavailable"} {...props} getTarget={getTarget} onApply={onApply} /> : tool === 'sequence' ? <SequencePanel {...props} /> : tool === 'chemistry' ? <ChemistryPanel {...props} /> : tool === 'plate' ? <PlatePanel {...props} /> : tool === 'checks' ? <RecordedChecksPanel {...props} /> : tool === 'review' ? <CandidateReviewPanel {...props} /> : <div className="notebook-science-panel">
          <h3>{t('capabilities')}</h3>
          <dl>
            <dt>{t('sequence')}</dt><dd>{t('sequenceLimits')}</dd>
            <dt>{t('chemistry')}</dt><dd>{t('chemistryLimits')}</dd>
            <dt>{t('plate')}</dt><dd>24 / 96 / 384 / 1536. {t('plateHint')}</dd>
            <dt>{t('review')}</dt><dd>{t('reviewLimits')}</dd>
            <dt>{t('checks')}</dt><dd>{t('checksLimits')}</dd>
          </dl>
          <p className="notebook-note">Pero method versions and complete inputs are included in each snapshot. / 每份快照包含 Pero 方法版本与完整输入。</p>
          <p className="notebook-note">Research inventories are not executable features. / 研究目录不等于可执行功能。</p>
          <a href="https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi" target="_blank" rel="noreferrer">NCBI genetic code tables / 遗传密码表</a>
        </div>}
      </div>
    </Dialog>}
  </>;
}
