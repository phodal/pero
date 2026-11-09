import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dialog, Feedback, Field, Input, NativeSelect } from '@pero/app-sdk/ui';
import type { NotebookDocument } from '@pero/notebook';
import { defaultPrintSettings, notebookPageRule, notebookPrintSections, parsePrintSettings, type NotebookPrintSettings } from '@pero/notebook/notebook-print';
import { NotebookPrintContent } from './notebook-print-content';
import './notebook-print.css';

export const NOTEBOOK_PRINT_OPEN_EVENT = 'pero:notebook-print-open';
export function NotebookPrintTools({ document: notebook, entryId, revision, dirty = false }: { document: NotebookDocument; entryId: string; revision: number; dirty?: boolean }) {
  const [open, setOpen] = useState(false), [settings, setSettings] = useState<NotebookPrintSettings>(() => defaultPrintSettings(notebook));
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [preparedAt, setPreparedAt] = useState('');
  const sections = notebookPrintSections(notebook), storageKey = `pero:notebook:print:v1:${entryId}`;
  const load = () => {
    setError(''); setNotice(''); setPreparedAt(new Date().toISOString());
    try { setSettings(parsePrintSettings(JSON.parse(window.localStorage.getItem(storageKey) ?? 'null'), notebook)); }
    catch { setSettings(defaultPrintSettings(notebook)); setNotice('Saved print settings could not be read. Defaults are shown. / 无法读取打印设置，已恢复默认值。'); }
    setOpen(true);
  };
  useEffect(() => {
    const show = (event: Event) => { if (!(event instanceof CustomEvent) || !event.detail?.entryId || event.detail.entryId === entryId) load(); };
    window.addEventListener(NOTEBOOK_PRINT_OPEN_EVENT, show);
    return () => window.removeEventListener(NOTEBOOK_PRINT_OPEN_EVENT, show);
  }, [entryId, notebook]);
  const change = (patch: Partial<NotebookPrintSettings>) => { setSettings(previous => ({ ...previous, ...patch })); setError(''); setNotice(''); };
  const selected = settings.sections.filter(id => sections.some(section => section.id === id));
  const valid = Number.isFinite(settings.marginMm) && settings.marginMm >= 5 && settings.marginMm <= 40 && selected.length > 0;
  const saveSettings = () => { try { window.localStorage.setItem(storageKey, JSON.stringify(settings)); setNotice('Print preferences saved for this entry on this device. / 已在本设备保存此条目的打印偏好。'); } catch { setError('Print settings could not be saved. Printing is still available. / 无法保存设置，仍可打印。'); } };
  const output = <NotebookPrintContent document={notebook} settings={settings} entryId={entryId} revision={revision} dirty={dirty} preparedAt={preparedAt} />;
  return <>
    <Button variant="ghost" onClick={load}>Print options / 打印设置</Button>
    {open && <Dialog title="Print options / 打印设置" closeLabel="Close print options / 关闭打印设置" size="lg" onClose={() => setOpen(false)}>
      <div className="notebook-science-fields">
        <Field label="Paper / 纸张">{control => <NativeSelect {...control} value={settings.paper} onChange={event => change({ paper: event.target.value as NotebookPrintSettings['paper'] })}><option>A4</option><option>Letter</option></NativeSelect>}</Field>
        <Field label="Orientation / 方向">{control => <NativeSelect {...control} value={settings.orientation} onChange={event => change({ orientation: event.target.value as NotebookPrintSettings['orientation'] })}><option value="portrait">Portrait / 纵向</option><option value="landscape">Landscape / 横向</option></NativeSelect>}</Field>
        <Field label="Margins (mm, 5–40) / 页边距">{control => <Input {...control} type="number" min={5} max={40} value={Number.isNaN(settings.marginMm) ? '' : settings.marginMm} onChange={event => change({ marginMm: event.target.value === '' ? NaN : Number(event.target.value) })} />}</Field>
      </div>
      <fieldset><legend>Include sections / 打印章节</legend><div className="notebook-print-options">{sections.map(section => <label key={section.id}><input type="checkbox" checked={settings.sections.includes(section.id)} onChange={event => change({ sections: event.target.checked ? [...settings.sections, section.id] : settings.sections.filter(id => id !== section.id) })} />{section.label}</label>)}</div></fieldset>
      <div className="notebook-print-options"><label><input type="checkbox" checked={settings.includeMetadata} onChange={event => change({ includeMetadata: event.target.checked })} />Revision, preparation time and metadata / 版本、生成时间和元数据</label><label><input type="checkbox" checked={settings.includeInputs} onChange={event => change({ includeInputs: event.target.checked })} />Show formulas under calculated values / 计算值下显示公式</label></div>
      <p className="notebook-note">Interactive controls are always removed. All chosen sections print even when their editor tab is closed. Confirm paper and margins in the system dialog; browser headers and scaling remain browser-controlled. / 隐藏交互控件并打印所选章节；请在系统窗口确认纸张与页边距，浏览器负责页眉和缩放。</p>
      {!valid && <Feedback kind="warning">Choose at least one section and margins between 5 and 40 mm. / 至少选择一节，页边距为 5–40 mm。</Feedback>}
      {error && <Feedback kind="error">{error}</Feedback>}{notice && <Feedback kind="info">{notice}</Feedback>}
      <div className="notebook-science-actions"><Button disabled={!valid} onClick={saveSettings}>Save print preferences / 保存打印偏好</Button><Button variant="primary" disabled={!valid} onClick={() => { setError(''); try { window.print(); } catch (cause) { setError(String(cause)); } }}>Print / 打印</Button></div>
      <p>Content preview, not a page-count guarantee. / 内容预览，不保证实际分页。</p>
      <div className="notebook-print-preview" data-orientation={settings.orientation} aria-label="Print content preview / 打印内容预览">{output}</div>
    </Dialog>}
    {open && valid && createPortal(<div className="notebook-print-output"><style>{notebookPageRule(settings)}</style>{output}</div>, document.body)}
  </>;
}
