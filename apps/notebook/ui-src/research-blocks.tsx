import type { NodeViewProps } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { requestAppShell, useAppApi, useAppContext, useAppI18n } from '@pero/app-sdk';
import { referenceReview, type StoredReferenceProposal } from '@pero/notebook/scientific-block';
import { useNotebookContext } from './notebook-context';
import { Badge, Button, Checkbox, Disclosure, Feedback, Icon, Input, Textarea } from '@pero/app-sdk/ui';
import { parsePaperCitation, scientificReferenceState, type ScientificReference, type ReferenceSnapshot } from '@pero/notebook';
import { projectNotebook, readStoredReference } from '@pero/notebook/interchange';
import { parseControlEvidenceLocation } from '@pero/notebook/control-evidence';
import { BlockFrame } from './block-frame';
import { notebookEvidence } from './evidence-model';
import { messages } from './messages';
import { ReferenceImport, SnapshotDetails } from './reference-import';

const emptyReference: ScientificReference = { app: '', kind: '', id: '', version: '', locator: '' };
const referenceFields = [
  ['app', 'referenceApp'], ['kind', 'referenceKind'], ['id', 'referenceId'],
  ['version', 'referenceVersion'], ['locator', 'referenceLocator'],
] as const;

function ownerAction(source: ScientificReference | null) {
  if (!source || source.locator !== source.locator.trim()) return null;
  if (source.app === 'paper-agent') {
    const paper = parsePaperCitation(source.locator);
    if (paper && paper.id === source.id && paper.kind === source.kind && paper.version === source.version) return 'openPaperSource';
  }
  if (source.app === 'control-lab' && source.kind === 'verification-report' &&
      parseControlEvidenceLocation(source.locator)?.experimentId === source.id) return 'openControlSource';
  return null;
}

function ReferenceView({ view, kind }: { view: NodeViewProps; kind: 'evidence' | 'experiment' }) {
  const { t } = useAppI18n(messages);
  const { name: appName } = useAppContext();
  const api = useAppApi();
  const notebook = useNotebookContext();
  const [citation, setCitation] = useState('');
  const [editingReference, setEditingReference] = useState(!view.node.attrs.snapshot);
  const labelInput = useRef<HTMLInputElement>(null);
  const [citationError, setCitationError] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<StoredReferenceProposal | null>(null);
  const [proposalNote, setProposalNote] = useState('');
  const [proposalError, setProposalError] = useState('');
  const [proposalBusy, setProposalBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<{ locator: string; message: string } | null>(null);
  const { label, source, snapshot } = view.node.attrs as { label: string; source: ScientificReference | null; snapshot: ReferenceSnapshot | null };
  const referenceState = scientificReferenceState(source);
  const stored = readStoredReference(view.node.toJSON());
  const interchange = projectNotebook({ type: 'doc', content: [view.node.toJSON()] });
  const snapshotStays = interchange.losses.some(loss => loss.code === 'snapshot-not-in-editor-props');
  const complete = referenceState === 'unpinned' || referenceState === 'pinned';
  const pinned = referenceState === 'pinned';
  const editable = view.editor.isEditable;
  const openAction = window.parent !== window || appName === 'notebook' ? ownerAction(source) : null;

  const changeSource = (field: keyof ScientificReference, value: string) => {
    const next = { ...emptyReference, ...source, [field]: value };
    view.updateAttributes({ source: Object.values(next).some(item => item.trim()) ? next : null });
  };
  const attachCitation = () => {
    const reference = parsePaperCitation(citation);
    if (!reference) { setCitationError(true); return; }
    view.updateAttributes({ source: reference, label: label || t('paperCitation') });
    setCitation('');
    setCitationError(false);
  };
  const openSource = async () => {
    if (!source) return;
    const locator = source.locator;
    setOpening(true);
    setOpenError(null);
    try { await requestAppShell<void>('open-research-source', { href: locator }); }
    catch (cause) { setOpenError({ locator, message: cause instanceof Error ? cause.message : String(cause) }); }
    finally { setOpening(false); }
  };
  useEffect(() => {
    const blockId = view.node.attrs.blockId;
    if (!notebook || !pinned || typeof blockId !== 'string') { setPendingProposal(null); return; }
    let live = true;
    void api.get<{ proposals: StoredReferenceProposal[] }>(`/api/entries/${notebook.entryId}/block-proposals`).then(result => {
      if (live) setPendingProposal(result.proposals.find(item => item.decision === 'pending' && item.blockId === blockId) ?? null);
    }).catch(() => { if (live) setPendingProposal(null); });
    return () => { live = false; };
  }, [api, notebook, pinned, view.node.attrs.blockId]);
  const reviewProposal = async (decision: 'accept' | 'reject') => {
    if (!notebook || !pendingProposal) return;
    if (typeof view.node.attrs.blockId !== 'string') { setProposalError(t('interchangeMissing')); return; }
    if (notebook.dirty) {
      setProposalError(t('proposalDirty'));
      return;
    }
    setProposalBusy(true);
    setProposalError('');
    setProposalNote('');
    try {
      const body = referenceReview({ proposalId: pendingProposal.proposalId, expectedRevision: notebook.revision, decision });
      const result = await api.post<{ entry: { id: string; revision: number; document: { schemaVersion: number } }; proposal: { decision: string; revision: number } }>(
        `/api/entries/${notebook.entryId}/block-proposals`, body);
      setProposalNote(t(result.proposal.decision === 'accept' ? 'proposalAccepted' : 'proposalRejected', { revision: result.proposal.revision }));
      if (result.proposal.decision === 'accept') window.dispatchEvent(new CustomEvent('pero-notebook-entry-committed', { detail: result.entry }));
    } catch (cause) {
      setProposalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProposalBusy(false);
    }
  };
  const reference = source && <dl className="notebook-reference-details">{referenceFields.map(([field, labelKey]) =>
    source[field] && <div key={field}><dt>{t(labelKey)}</dt><dd>{source[field]}</dd></div>)}</dl>;
  const status = snapshot ? 'referenceImported' : pinned ? 'referencePinned' : complete ? 'referenceUnpinned' : 'referenceMissing';

  return <BlockFrame view={view} kind={kind}
    title={editable ? <Input ref={labelInput} unstyled className="notebook-block-name" aria-label={t('referenceLabel')}
      placeholder={t(kind)} maxLength={200} value={label} onChange={event => view.updateAttributes({ label: event.target.value })} />
      : <strong>{label || t(kind)}</strong>}
    caption={<Badge tone={pinned ? 'info' : 'neutral'}>{t(status)}</Badge>}
    actions={openAction && <Button variant="ghost" busy={opening} onClick={() => void openSource()}><Icon name="open" />{t(openAction)}</Button>}>
    <p className="notebook-note" data-editor-block-id={stored.editorBlockId ?? ''} data-object-version={stored.reference?.version ?? ''}>
      {t('editorBlock')}: {stored.editorBlockId ?? t('interchangeMissing')}
      {' · '}
      {t('objectVersion')}: {stored.reference?.version || t('interchangeUnpinned')}
    </p>
    {snapshotStays && <p className="notebook-note">{t('snapshotStaysInNotebook')}</p>}
    {notebook && pendingProposal && <fieldset className="notebook-reference-fields" disabled={proposalBusy || !editable}>
      <legend>{t('reviewReference')}</legend>
      <p>{t('proposalWording')}: {pendingProposal.label}</p>
      <Button variant="primary" onClick={() => void reviewProposal('accept')}>{t('acceptProposal')}</Button>
      <Button variant="ghost" onClick={() => void reviewProposal('reject')}>{t('rejectProposal')}</Button>
      {proposalNote && <p className="notebook-note">{proposalNote}</p>}
      {proposalError && <Feedback kind="error">{proposalError}</Feedback>}
    </fieldset>}
    {openError && openError.locator === source?.locator && <Feedback kind="error">{openError.message}</Feedback>}
    {snapshot && <>
      <SnapshotDetails snapshot={snapshot} />
      <Disclosure variant="inline" summary={t('referenceDetails')}>{reference}</Disclosure>
    </>}
    {editable && <Disclosure variant="inline" className="notebook-reference-edit"
      summary={t(snapshot ? 'editReference' : 'attachSource')} open={editingReference}
      onOpenChange={setEditingReference}>
      <ReferenceImport kind={kind} replacing={!!snapshot}
        onAttach={value => {
          view.updateAttributes({ label: value.label, source: value.reference, snapshot: value.snapshot });
          setCitation('');
          setCitationError(false);
          setEditingReference(false);
          requestAnimationFrame(() => labelInput.current?.focus());
        }} />
      {snapshot && <Button variant="ghost" onClick={() => view.updateAttributes({ snapshot: null })}>{t('detachSnapshot')}</Button>}
    </Disclosure>}
    {!snapshot && (editable ? <>
      <Disclosure variant="inline" summary={t('referenceDetails')} defaultOpen={!!source}>
        <div className="notebook-reference-fields notebook-manual-reference">
          {referenceFields.map(([field, labelKey]) => <label className={`notebook-field${field === 'locator' ? ' notebook-reference-wide' : ''}`} key={field}>
            {t(labelKey)}<Input maxLength={1024} value={source?.[field] ?? ''} onChange={event => changeSource(field, event.target.value)} />
          </label>)}
        </div>
      </Disclosure>
      {source && !complete && <p className="notebook-note">{t('referencePartial')}</p>}
      {kind === 'evidence' && <Disclosure variant="inline" summary={t('paperCitation')}>
        <label className="notebook-field">{t('paperCitationUrl')}
          <Input value={citation} maxLength={256} onChange={event => { setCitation(event.target.value); setCitationError(false); }} />
        </label>
        <Button variant="ghost" disabled={!citation.trim()} onClick={attachCitation}>{t('attachCitation')}</Button>
        {citationError && <Feedback kind="error">{t('invalidCitation')}</Feedback>}
      </Disclosure>}
    </> : reference)}
  </BlockFrame>;
}

export function EvidenceView(view: NodeViewProps) { return <ReferenceView view={view} kind="evidence" />; }
export function ExperimentView(view: NodeViewProps) { return <ReferenceView view={view} kind="experiment" />; }

export function FindingView(view: NodeViewProps) {
  const { t } = useAppI18n(messages);
  const { claim, limitations, evidenceIds } = view.node.attrs as { claim: string; limitations: string; evidenceIds: string[] };
  const editable = view.editor.isEditable;
  const evidence = useEditorState({
    editor: view.editor,
    selector: ({ editor }) => notebookEvidence(editor.state.doc),
  });
  const missing = evidenceIds.filter(id => !evidence.some(source => source.id === id));
  const updateLink = (id: string, checked: boolean) => view.updateAttributes({
    evidenceIds: checked ? [...evidenceIds, id] : evidenceIds.filter(value => value !== id),
  });
  const titleText = claim.trim();
  const title = titleText ? (titleText.length > 80 ? `${titleText.slice(0, 80)}…` : titleText) : '';
  return <BlockFrame view={view} kind="finding" title={title ? <strong>{title}</strong> : <span className="notebook-block-name" aria-hidden="true">&nbsp;</span>}>
    <div className="notebook-reference-fields">
      <label className="notebook-field notebook-reference-wide">{t('claim')}
        <Textarea rows={2} maxLength={32768} readOnly={!editable} value={claim} onChange={event => view.updateAttributes({ claim: event.target.value })} />
      </label>
      <label className="notebook-field notebook-reference-wide">{t('limitations')}
        <Textarea rows={2} maxLength={32768} readOnly={!editable} value={limitations} onChange={event => view.updateAttributes({ limitations: event.target.value })} />
      </label>
      <fieldset className="notebook-evidence-links notebook-reference-wide">
        <legend>{t('supportingEvidence')}</legend>
        {!evidence.length && !missing.length && <p className="notebook-note">{t('noEvidence')}</p>}
        {evidence.filter(source => editable || evidenceIds.includes(source.id)).map(source =>
          <label key={source.id} className="notebook-checkbox">
            {editable && <Checkbox checked={evidenceIds.includes(source.id)} onCheckedChange={checked => updateLink(source.id, checked === true)} />}
            <span>{source.label || t(source.kind)}</span><Badge tone={source.pinned ? 'info' : 'neutral'}>
              {t(source.imported ? 'referenceImported' : source.pinned ? 'referencePinned' : 'referenceUnpinned')}
            </Badge>
          </label>)}
        {missing.map(id => <label key={id} className="notebook-checkbox">
          {editable && <Checkbox checked onCheckedChange={() => updateLink(id, false)} />}
          <span>{t('missingEvidence')} · <code>{id}</code></span>
        </label>)}
      </fieldset>
    </div>
  </BlockFrame>;
}
