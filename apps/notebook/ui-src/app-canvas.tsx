import { useEffect, useRef, useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { DeclaredAppCanvas, listInstalledAppViews, requestAppShell, useAppI18n, type InstalledAppViews } from '@pero/app-sdk';
import { Button, Feedback, Field, Input, Select, Textarea } from '@pero/app-sdk/ui';
import { appCanvasAvailability, appCanvasPath, parseAppCanvasBinding, type AppCanvasBinding } from '@pero/notebook/app-canvas';
import { BlockFrame } from './block-frame';
import { useNotebookContext } from './notebook-context';

const messages = {
  embedded: { en: 'Embedded view', zh: '内嵌视图' }, inputs: { en: 'View inputs (JSON)', zh: '视图输入（JSON）' },
  panelOnly: { en: 'Panel navigation only', zh: '仅面板导航' }, schema: { en: 'Declared input schema', zh: '声明的输入结构' },
  saved: { en: 'Save this binding as a Notebook revision before mounting it. Host verifies the saved revision and asks separately before every App action.', zh: '挂载前请将绑定保存为笔记修订。Host 会核对已保存修订，并在每次 App 操作前单独询问。' },
  retained: { en: 'Unverified retained result. Saved or imported bytes are not authenticated App evidence.', zh: '未验证的保留结果。保存或导入的内容不代表经过认证的 App 证据。' },
  title: { en: 'App Canvas', zh: 'App 画布' }, label: { en: 'Canvas title', zh: '画布标题' },
  app: { en: 'Installed App', zh: '已安装 App' }, panel: { en: 'Declared view', zh: '已声明视图' },
  choose: { en: 'Choose an installed App', zh: '选择已安装 App' }, choosePanel: { en: 'Choose a declared view', zh: '选择已声明视图' },
  bind: { en: 'Save binding', zh: '保存绑定' }, open: { en: 'Open App view', zh: '打开 App 视图' }, remove: { en: 'Remove binding', zh: '移除绑定' },
  refresh: { en: 'Refresh installed Apps', zh: '刷新已安装 App' }, cancel: { en: 'Cancel catalog request', zh: '取消目录请求' },
  loading: { en: 'Reading installed declarations from Host…', zh: '正在从 Host 读取已安装声明…' },
  empty: { en: 'Host returned no installed Apps.', zh: 'Host 未返回已安装 App。' },
  source: { en: 'Source: current Host installation catalog. Refresh to check changes.', zh: '来源：当前 Host 安装目录。刷新以检查变更。' },
  stale: { en: 'Showing the previous catalog; current availability is unverified.', zh: '当前显示上次目录；最新可用性尚未核实。' },
  limits: { en: 'Only explicitly declared data views render inline. App actions require trusted Host confirmation; a saved binding grants no execution permission. Other panels open in their owning App.', zh: '仅显式声明的数据视图可内嵌显示。App 操作需要可信 Host 确认；保存绑定不授予执行权限。其他面板在所属 App 中打开。' },
  opened: { en: 'Host acknowledged navigation. No App action was executed by this Canvas.', zh: 'Host 已确认导航。此画布未执行 App 操作。' },
  actions: { en: 'Declared App actions', zh: 'App 声明的操作' },
  'unbound': { en: 'Choose an installed App and its declared view to bind this Canvas.', zh: '选择已安装 App 和声明视图以绑定此画布。' },
  'unknown': { en: 'Availability is unverified. Refresh the Host catalog; the saved binding is retained.', zh: '可用性尚未核实。请刷新 Host 目录；已保存的绑定仍然保留。' },
  'missing-app': { en: 'This App is no longer installed. The saved binding is retained.', zh: '此 App 已不在安装目录中。已保存的绑定仍然保留。' },
  'disabled-app': { en: 'This App is installed but disabled. Enable it in the Host before opening.', zh: '此 App 已安装但未启用。请先在 Host 中启用。' },
  'missing-panel': { en: 'This App no longer declares the saved view. Choose another declared view.', zh: '此 App 已不再声明所保存的视图。请选择其他声明视图。' },
  'missing-view': { en: 'This App no longer declares the embedded view. The saved binding is retained.', zh: '此 App 已不再声明内嵌视图。已保存绑定仍然保留。' },
  'changed-declaration': { en: 'The App declaration changed. Review and explicitly save a new binding before mounting.', zh: 'App 声明已变更。请核对并明确保存新绑定后再挂载。' },
  'available': { en: 'The saved view is declared by an enabled, installed App.', zh: '已保存视图由已安装且启用的 App 声明。' },
};
export function AppCanvasView(view: NodeViewProps) {
  const context = useNotebookContext();
  const { t } = useAppI18n(messages), binding = view.node.attrs.binding as AppCanvasBinding | null;
  const [app, setApp] = useState(binding?.app ?? ''), [panel, setPanel] = useState(binding?.panel ?? '');
  const [embedded, setEmbedded] = useState(binding?.view ?? ''), [inputs, setInputs] = useState(JSON.stringify(binding?.inputs ?? {}, null, 2));
  const [catalog, setCatalog] = useState<InstalledAppViews[] | null>(null), [verified, setVerified] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState<'catalog' | 'navigation' | null>(null), [opened, setOpened] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const load = async (open?: AppCanvasBinding) => {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy('catalog'); setError(''); setOpened(false); setVerified(false);
    try {
      const current = await listInstalledAppViews(controller.signal);
      if (controller.signal.aborted) return;
      setCatalog(current); setVerified(true);
      if (open) {
        const availability = appCanvasAvailability(open, current);
        if (availability !== 'available') throw new Error(t(availability));
        setBusy('navigation');
        await requestAppShell('navigate', { path: appCanvasPath(open) });
        if (!controller.signal.aborted) setOpened(true);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(null); }
    }
  };
  useEffect(() => {
    void load();
    return () => { pending.current?.abort(); pending.current = null; };
  }, []);
  useEffect(() => { setApp(binding?.app ?? ''); setPanel(binding?.panel ?? ''); setEmbedded(binding?.view ?? ''); setInputs(JSON.stringify(binding?.inputs ?? {}, null, 2)); setOpened(false); }, [binding?.id, binding?.app, binding?.panel, binding?.view]);
  const selectedApp = catalog?.find(item => item.app === app);
  const selectedView = selectedApp?.canvases?.find(item => item.id === embedded);
  const boundApp = catalog?.find(item => item.app === binding?.app);
  const selectedPanel = selectedApp?.panels.find(item => item.id === panel);
  const availability = appCanvasAvailability(binding, verified ? catalog : null);
  return <BlockFrame view={view} kind="appCanvas" title={<strong>{view.node.attrs.label || t('title')}</strong>}>
    <p className="notebook-note">{t('limits')}</p>
    {binding && <p>{binding.app} / {binding.panel} · {binding.id}</p>}
    <p role="status">{busy === 'catalog' ? t('loading') : t(availability)}</p>
    {catalog && <p className="notebook-note">{t(verified ? 'source' : 'stale')}</p>}
    {catalog?.length === 0 && <p>{t('empty')}</p>}
    <Button disabled={!!busy} onClick={() => void load()}>{t('refresh')}</Button>
    {busy === 'catalog' && <Button onClick={() => { pending.current?.abort(); pending.current = null; setBusy(null); }}>{t('cancel')}</Button>}
    {view.editor.isEditable && <div className="notebook-science-fields">
      <Field label={t('label')}>{control => <Input {...control} value={view.node.attrs.label || ''} maxLength={200} onChange={event => view.updateAttributes({ label: event.target.value })} />}</Field>
      <Select label={t('app')} placeholder={t('choose')} disabled={!!busy || !verified} value={app}
        options={(catalog ?? []).map(item => ({ value: item.app, label: item.title, hint: `${item.app} · ${item.version}${item.enabled ? '' : ` · ${t('disabled-app')}`}`, disabled: !item.enabled }))}
        onChange={value => { setApp(value); setPanel(''); setEmbedded(''); setInputs('{}'); }} />
      <Select label={t('panel')} placeholder={t('choosePanel')} disabled={!!busy || !verified || !selectedApp?.enabled} value={panel}
        options={(selectedApp?.panels ?? []).map(item => ({ value: item.id, label: item.title, hint: item.id }))} onChange={setPanel} />
      {!!selectedApp?.canvases?.length && <Select label={t('embedded')} value={embedded} disabled={!!busy || !verified}
        options={[{ value: '', label: t('panelOnly') }, ...selectedApp.canvases.map(item => ({ value: item.id, label: item.title }))]} onChange={setEmbedded} />}
      {selectedView && <><Field label={t('inputs')}>{control => <Textarea {...control} value={inputs} onChange={event => setInputs(event.target.value)} rows={4} />}</Field>
        <details><summary>{t('schema')}</summary><pre>{JSON.stringify(selectedView.inputs, null, 2)}</pre></details></>}
      <Button disabled={!!busy || !verified || !selectedApp?.enabled || !selectedPanel} onClick={() => {
        try {
          const next = parseAppCanvasBinding({ id: binding?.id ?? crypto.randomUUID(), app, panel,
            ...(selectedView ? { view: selectedView.id, declaration: selectedApp!.revision, inputs: JSON.parse(inputs) } : {}) });
          view.updateAttributes({ binding: next }); setError(''); setOpened(false);
        } catch (cause) { setError(String(cause)); }
      }}>{t('bind')}</Button>
      <Button disabled={!binding || !!busy} onClick={() => { view.updateAttributes({ binding: null }); setOpened(false); }}>{t('remove')}</Button>
    </div>}
    {binding && <Button busy={busy === 'navigation'} disabled={!!busy} onClick={() => void load(binding)}>{t('open')}</Button>}
    {binding?.view && <><p className="notebook-note">{t('saved')}</p>{context && <DeclaredAppCanvas source={{ entryId: context.entryId, revision: context.revision, blockId: view.node.attrs.blockId,
      readOnly: context.readonly || !view.editor.isEditable, binding: { id: binding.id, app: binding.app, panel: binding.panel, view: binding.view!, declaration: binding.declaration!, inputs: binding.inputs! } }} onResult={receipt => {
        if (!view.editor.isEditable) return;
        try { view.updateAttributes({ binding: parseAppCanvasBinding({ ...binding, receipt }) }); }
        catch (cause) { setError(String(cause)); }
      }} />}</>}
    {binding?.receipt && <details><summary>{t('retained')}</summary><pre>{JSON.stringify(binding.receipt, null, 2)}</pre></details>}
    {boundApp && <p>{boundApp.title} · {boundApp.version} · {boundApp.revision}</p>}
    {!!boundApp?.actions.length && <details><summary>{t('actions')}</summary><ul>{boundApp.actions.map(action =>
      <li key={action.name}><strong>{action.name}</strong>: {action.description}</li>)}</ul></details>}
    {opened && <Feedback kind="info">{t('opened')}</Feedback>}{error && <Feedback kind="error">{error}</Feedback>}
  </BlockFrame>;
}
