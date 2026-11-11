import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { DeclaredAppCanvas, listInstalledAppViews, requestAppShell, useAppI18n, type InstalledAppViews } from '@pero/app-sdk';
import { Button, Disclosure, Feedback, Field, Input, Select, Textarea } from '@pero/app-sdk/ui';
import { appCanvasAvailability, appCanvasPath, parseAppCanvasBinding, type AppCanvasBinding } from '@pero/notebook/app-canvas';
import { BlockFrame } from './block-frame';
import { useNotebookContext } from './notebook-context';
import { ControlLabInputs, ControlLabInputError, controlMapping, controlParameterOptions, controlPins, sameControlPins } from './control-lab-canvas';

const controlView = 'notebook-experiment';

const messages = {
  embedded: { en: 'Embedded view', zh: '内嵌视图' }, inputs: { en: 'View inputs (JSON)', zh: '视图输入（JSON）' },
  panelOnly: { en: 'Panel navigation only', zh: '仅面板导航' }, schema: { en: 'Declared input schema', zh: '声明的输入结构' },
  saved: { en: 'Save this binding as a Notebook revision before mounting it. Host verifies the saved revision and asks separately before every App action.', zh: '挂载前请将绑定保存为笔记修订。Host 会核对已保存修订，并在每次 App 操作前单独询问。' },
  retained: { en: 'Retained result · unverified', zh: '保留结果 · 未核验' },
  help: { en: 'Canvas permissions and views', zh: '画布权限与视图' },
  bindingDetails: { en: 'Binding details', zh: '绑定详情' },
  title: { en: 'App Canvas', zh: 'App 画布' }, label: { en: 'Canvas title', zh: '画布标题' },
  app: { en: 'Installed App', zh: '已安装 App' }, panel: { en: 'Declared view', zh: '已声明视图' },
  choose: { en: 'Choose an installed App', zh: '选择已安装 App' }, choosePanel: { en: 'Choose a declared view', zh: '选择已声明视图' },
  bind: { en: 'Save binding', zh: '保存绑定' }, open: { en: 'Open App view', zh: '打开 App 视图' }, remove: { en: 'Remove binding', zh: '移除绑定' },
  refresh: { en: 'Refresh installed Apps', zh: '刷新已安装 App' }, cancel: { en: 'Cancel catalog request', zh: '取消目录请求' },
  loading: { en: 'Reading installed declarations from Host…', zh: '正在从 Host 读取已安装声明…' },
  empty: { en: 'Host returned no installed Apps.', zh: 'Host 未返回已安装 App。' },
  stale: { en: 'Showing the previous catalog; current availability is unverified.', zh: '当前显示上次目录；最新可用性尚未核实。' },
  limits: { en: 'Only explicitly declared data views render inline. App actions require trusted Host confirmation; a saved binding grants no execution permission. Other panels open in their owning App.', zh: '仅显式声明的数据视图可内嵌显示。App 操作需要可信 Host 确认；保存绑定不授予执行权限。其他面板在所属 App 中打开。' },
  openExperiment: { en: 'Open created experiment', zh: '打开已创建的实验' },
  opened: { en: 'Open request acknowledged.', zh: '打开请求已确认。' },
  actions: { en: 'Declared App actions', zh: 'App 声明的操作' },
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
  const [mapping, setMapping] = useState(() => controlMapping(binding?.inputs));
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
  useEffect(() => { setApp(binding?.app ?? ''); setPanel(binding?.panel ?? ''); setEmbedded(binding?.view ?? ''); setInputs(JSON.stringify(binding?.inputs ?? {}, null, 2)); setMapping(controlMapping(binding?.inputs)); setOpened(false); }, [binding?.id, binding?.app, binding?.panel, binding?.view]);
  const selectedApp = catalog?.find(item => item.app === app);
  const selectedView = selectedApp?.canvases?.find(item => item.id === embedded);
  const boundApp = catalog?.find(item => item.app === binding?.app);
  const selectedPanel = selectedApp?.panels.find(item => item.id === panel);
  const availability = appCanvasAvailability(binding, verified ? catalog : null);
  const selectingControl = app === 'control-lab' && embedded === controlView;
  const boundControl = binding?.app === 'control-lab' && binding.view === controlView;
  const controlDocument = selectingControl || boundControl ? context?.document : undefined;
  const choices = useMemo(() => controlDocument ? controlParameterOptions(controlDocument) : null, [controlDocument]);
  const pins = selectingControl && choices ? controlPins(choices, mapping) : null;
  const staleControl = boundControl && !!choices &&
    !sameControlPins(controlPins(choices, controlMapping(binding.inputs)), binding.inputs);
  const experimentResult = binding?.receipt?.result;
  const experimentId = boundControl && experimentResult && typeof experimentResult === 'object' && 'experimentId' in experimentResult &&
    typeof experimentResult.experimentId === 'string' && /^[a-f0-9]{32}$/.test(experimentResult.experimentId)
    ? experimentResult.experimentId : null;
  return <BlockFrame view={view} kind="appCanvas"
    title={view.editor.isEditable
      ? <Input unstyled className="notebook-block-name" aria-label={t('label')} placeholder={t('title')} maxLength={200}
        value={view.node.attrs.label || ''} onChange={event => view.updateAttributes({ label: event.target.value })} />
      : <strong>{view.node.attrs.label || t('title')}</strong>}
    help={{ title: t('help'), content: <><p>{t('limits')}</p><p>{t('saved')}</p></> }}>
    {busy === 'catalog' ? <p role="status">{t('loading')}</p>
      : binding && availability !== 'unbound' && availability !== 'available' ? <p role="status">{t(availability)}</p>
      : verified && catalog?.length === 0 && <p role="status">{t('empty')}</p>}
    {catalog && !verified && !busy && !binding && <p role="status">{t('stale')}</p>}
    <Button disabled={!!busy} onClick={() => void load()}>{t('refresh')}</Button>
    {busy === 'catalog' && <Button onClick={() => { pending.current?.abort(); pending.current = null; setBusy(null); }}>{t('cancel')}</Button>}
    {view.editor.isEditable && <div className="notebook-science-fields">
      <Select label={t('app')} placeholder={t('choose')} disabled={!!busy || !verified} value={app}
        options={(catalog ?? []).map(item => ({ value: item.app, label: item.title, hint: `${item.app} · ${item.version}${item.enabled ? '' : ` · ${t('disabled-app')}`}`, disabled: !item.enabled }))}
        onChange={value => { setApp(value); setPanel(''); setEmbedded(''); setInputs('{}'); }} />
      <Select label={t('panel')} placeholder={t('choosePanel')} disabled={!!busy || !verified || !selectedApp?.enabled} value={panel}
        options={(selectedApp?.panels ?? []).map(item => ({ value: item.id, label: item.title, hint: item.id }))} onChange={setPanel} />
      {!!selectedApp?.canvases?.length && <Select label={t('embedded')} value={embedded} disabled={!!busy || !verified}
        options={[{ value: '', label: t('panelOnly') }, ...selectedApp.canvases.map(item => ({ value: item.id, label: item.title }))]} onChange={setEmbedded} />}
      {selectingControl && choices && <ControlLabInputs choices={choices} mapping={mapping} onChange={setMapping} />}
      {selectingControl && !pins && <ControlLabInputError />}
      {selectedView && !selectingControl && <><Field label={t('inputs')}>{control => <Textarea {...control} value={inputs} onChange={event => setInputs(event.target.value)} rows={4} />}</Field>
        <details><summary>{t('schema')}</summary><pre>{JSON.stringify(selectedView.inputs, null, 2)}</pre></details></>}
      <Button disabled={!!busy || !verified || !selectedApp?.enabled || !selectedPanel || (selectingControl && !pins)} onClick={() => {
        try {
          const currentPins = selectingControl && context ? controlPins(controlParameterOptions(context.getDocument()), mapping) : null;
          if (selectingControl && !currentPins) return;
          const unchangedControl = !!currentPins && boundControl && sameControlPins(currentPins, binding.inputs);
          const id = currentPins && !unchangedControl ? crypto.randomUUID().replaceAll('-', '') : binding?.id ?? crypto.randomUUID();
          const next = parseAppCanvasBinding({ id, app, panel,
            ...(selectedView ? { view: selectedView.id, declaration: selectedApp!.revision,
              inputs: currentPins ? { submissionId: id, ...currentPins } : JSON.parse(inputs) } : {}),
            ...(unchangedControl && binding.receipt ? { receipt: binding.receipt } : {}) });
          view.updateAttributes({ binding: next }); setError(''); setOpened(false);
        } catch (cause) { setError(String(cause)); }
      }}>{t('bind')}</Button>
      {binding && <Button variant="ghost" disabled={!!busy} onClick={() => { view.updateAttributes({ binding: null }); setOpened(false); }}>{t('remove')}</Button>}
    </div>}
    {binding && <Button busy={busy === 'navigation'} disabled={!!busy} onClick={() => void load(binding)}>{t('open')}</Button>}
    {experimentId && <Button onClick={() => {
      setError('');
      void requestAppShell('open-research-source', { href: `pero-app-location://control-lab/main/experiment/${experimentId}` })
        .catch(cause => setError(String(cause)));
    }}>{t('openExperiment')}</Button>}
    {staleControl && <ControlLabInputError stale />}
    {binding?.view && !staleControl && context && <DeclaredAppCanvas source={{ entryId: context.entryId, revision: context.revision, blockId: view.node.attrs.blockId,
      readOnly: context.readonly || !view.editor.isEditable, binding: { id: binding.id, app: binding.app, panel: binding.panel, view: binding.view!, declaration: binding.declaration!, inputs: binding.inputs! } }} onResult={receipt => {
        if (!view.editor.isEditable) return;
        try { view.updateAttributes({ binding: parseAppCanvasBinding({ ...binding, receipt }) }); }
        catch (cause) { setError(String(cause)); }
      }} />}
    {binding?.receipt && <details><summary>{t('retained')}</summary><pre>{JSON.stringify(binding.receipt, null, 2)}</pre></details>}
    {binding && <Disclosure variant="inline" summary={t('bindingDetails')}>
      <p>{binding.app} / {binding.panel} · <code>{binding.id}</code></p>
      {boundApp && <p>{boundApp.title} · {boundApp.version} · {boundApp.revision}</p>}
    </Disclosure>}
    {!!boundApp?.actions.length && <details><summary>{t('actions')}</summary><ul>{boundApp.actions.map(action =>
      <li key={action.name}><strong>{action.name}</strong>: {action.description}</li>)}</ul></details>}
    {opened && <Feedback kind="info">{t('opened')}</Feedback>}{error && <Feedback kind="error">{error}</Feedback>}
  </BlockFrame>;
}
