import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Dialog, Feedback, Field, Input, NativeSelect } from '@pero/app-sdk/ui';
import type { NotebookDocument } from '@pero/notebook';
import { defaultPrintSettings, notebookPageRule, notebookPrintSections, parsePrintSettings, type NotebookPrintSettings } from '@pero/notebook/notebook-print';
import { NotebookPrintContent, visiblePrintSectionLabel } from './notebook-print-content';
import { messages } from './messages';
import './notebook-print.css';

const PUBLICATION_PRINT_EVENT = 'pero:notebook-publication-print';
/** Receives only HTML from the inert publication renderer, never authored HTML. */
export function openNotebookPublicationPrint(html: string) { window.dispatchEvent(new CustomEvent(PUBLICATION_PRINT_EVENT, { detail: html })); }

export const NOTEBOOK_PRINT_OPEN_EVENT = 'pero:notebook-print-open';
export function NotebookPrintTools({ document: notebook, entryId, revision, dirty = false }: { document: NotebookDocument; entryId: string; revision: number; dirty?: boolean }) {
  const { t } = useAppI18n(messages);
  const [open, setOpen] = useState(false), [settings, setSettings] = useState<NotebookPrintSettings>(() => defaultPrintSettings(notebook));
  const [publication, setPublication] = useState<string | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [preparedAt, setPreparedAt] = useState('');
  const sections = notebookPrintSections(notebook), storageKey = `pero:notebook:print:v1:${entryId}`;
  const load = () => {
    setPublication(null); setError(''); setNotice(''); setPreparedAt(new Date().toISOString());
    try { setSettings(parsePrintSettings(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null'), notebook)); }
    catch { setSettings(defaultPrintSettings(notebook)); setNotice(t('printSettingsUnread')); }
    setOpen(true);
  };
  useEffect(() => {
    const show = (event: Event) => { if (!(event instanceof CustomEvent) || !event.detail?.entryId || event.detail.entryId === entryId) load(); };
    window.addEventListener(NOTEBOOK_PRINT_OPEN_EVENT, show);
    return () => window.removeEventListener(NOTEBOOK_PRINT_OPEN_EVENT, show);
  }, [entryId, notebook]);
  useEffect(() => {
    const show = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return;
      const parsed = new window.DOMParser().parseFromString(event.detail, 'text/html');
      const main = parsed.querySelector('main'); if (!main) return;
      main.querySelectorAll('.source').forEach(node => node.remove());
      setPublication(main.innerHTML); setOpen(false); setError('');
    };
    const done = () => setPublication(null);
    window.addEventListener(PUBLICATION_PRINT_EVENT, show); window.addEventListener('afterprint', done);
    return () => { window.removeEventListener(PUBLICATION_PRINT_EVENT, show); window.removeEventListener('afterprint', done); };
  }, []);
  const change = (patch: Partial<NotebookPrintSettings>) => { setSettings(previous => ({ ...previous, ...patch })); setError(''); setNotice(''); };
  const selected = settings.sections.filter(id => sections.some(section => section.id === id));
  const valid = Number.isFinite(settings.marginMm) && settings.marginMm >= 5 && settings.marginMm <= 40 && selected.length > 0;
  const saveSettings = () => { try { window.localStorage.setItem(storageKey, JSON.stringify(settings)); setNotice(t('printPreferencesSaved')); } catch { setError(t('printSettingsUnsaved')); } };
  const output = <NotebookPrintContent document={notebook} settings={settings} entryId={entryId} revision={revision} dirty={dirty} preparedAt={preparedAt} />;
  return <>
    {publication !== null && createPortal(<Dialog title={t('printOptions')} closeLabel={t('closePrintOptions')} size="lg" onClose={() => setPublication(null)}>
      <p>{t('printHint')}</p>{error && <Feedback kind="error">{error}</Feedback>}
      <Button variant="primary" onClick={() => { try { window.print(); } catch (cause) { setError(String(cause)); } }}>{t('printAction')}</Button>
      <div className="notebook-print-preview notebook-print-document" dangerouslySetInnerHTML={{ __html: publication }} />
    </Dialog>, document.body)}
    {publication !== null && createPortal(<div className="notebook-print-output notebook-print-document" data-publication="myst"><style>{notebookPageRule(settings)}</style><div dangerouslySetInnerHTML={{ __html: publication }} /></div>, document.body)}
    <Button variant="ghost" onClick={load}>{t('printOptions')}</Button>
    {open && createPortal(<Dialog title={t('printOptions')} closeLabel={t('closePrintOptions')} size="lg" onClose={() => setOpen(false)}>
      <div className="notebook-science-fields">
        <Field label={t('printPaper')}>{control => <NativeSelect {...control} value={settings.paper} onChange={event => change({ paper: event.target.value as NotebookPrintSettings['paper'] })}><option>A4</option><option>Letter</option></NativeSelect>}</Field>
        <Field label={t('printOrientation')}>{control => <NativeSelect {...control} value={settings.orientation} onChange={event => change({ orientation: event.target.value as NotebookPrintSettings['orientation'] })}><option value="portrait">{t('printPortrait')}</option><option value="landscape">{t('printLandscape')}</option></NativeSelect>}</Field>
        <Field label={t('printMargins')}>{control => <Input {...control} type="number" min={5} max={40} value={Number.isNaN(settings.marginMm) ? '' : settings.marginMm} onChange={event => change({ marginMm: event.target.value === '' ? NaN : Number(event.target.value) })} />}</Field>
      </div>
      <fieldset><legend>{t('printIncludeSections')}</legend><div className="notebook-print-options">{sections.map(section => <label key={section.id}><input type="checkbox" checked={settings.sections.includes(section.id)} onChange={event => change({ sections: event.target.checked ? [...settings.sections, section.id] : settings.sections.filter(id => id !== section.id) })} />{visiblePrintSectionLabel(section, t)}</label>)}</div></fieldset>
      <div className="notebook-print-options"><label><input type="checkbox" checked={settings.includeMetadata} onChange={event => change({ includeMetadata: event.target.checked })} />{t('printIncludeMetadata')}</label><label><input type="checkbox" checked={settings.includeInputs} onChange={event => change({ includeInputs: event.target.checked })} />{t('printShowFormulas')}</label></div>
      <p className="notebook-note">{t('printHint')}</p>
      {!valid && <Feedback kind="warning">{t('printInvalid')}</Feedback>}
      {error && <Feedback kind="error">{error}</Feedback>}{notice && <Feedback kind="info">{notice}</Feedback>}
      <div className="notebook-science-actions"><Button disabled={!valid} onClick={saveSettings}>{t('savePrintPreferences')}</Button><Button variant="primary" disabled={!valid} onClick={() => { setError(''); try { window.print(); } catch (cause) { setError(String(cause)); } }}>{t('printAction')}</Button></div>
      <p>{t('printPreviewHint')}</p>
      <div className="notebook-print-preview" data-orientation={settings.orientation} aria-label={t('printPreviewLabel')}>{output}</div>
    </Dialog>, document.body)}
    {open && valid && createPortal(<div className="notebook-print-output"><style>{notebookPageRule(settings)}</style>{output}</div>, document.body)}
  </>;
}
