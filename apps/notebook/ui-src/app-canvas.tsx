import { useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { requestAppShell, useAppI18n } from '@pero/app-sdk';
import { Button, Feedback, Field, Input } from '@pero/app-sdk/ui';
import { appCanvasPath, parseAppCanvasBinding, type AppCanvasBinding } from '@pero/notebook/app-canvas';
import { BlockFrame } from './block-frame';

const messages = {
  title: { en: 'App Canvas', zh: 'App 画布' }, app: { en: 'Installed App name', zh: '已安装 App 名称' }, panel: { en: 'Declared panel ID', zh: '已声明面板 ID' },
  bind: { en: 'Save binding', zh: '保存绑定' }, open: { en: 'Open App view', zh: '打开 App 视图' }, remove: { en: 'Remove binding', zh: '移除绑定' },
  limits: { en: 'This Host exposes navigation, not inline App embedding or cross-App actions. Enter an installed App and its declared panel. Opening asks Host to resolve availability; saving does not verify installation. No scripts or webhooks run here.', zh: '当前 Host 支持导航，不提供内嵌 App 或跨 App 操作。填写已安装 App 及其声明面板；打开时由 Host 检查可用性，保存不代表已验证安装。此处不运行脚本或 webhook。' },
  opened: { en: 'Host acknowledged the navigation request. This is not an execution receipt.', zh: 'Host 已确认导航请求。这不是执行回执。' },
};
export function AppCanvasView(view: NodeViewProps) {
  const { t } = useAppI18n(messages), binding = view.node.attrs.binding as AppCanvasBinding | null;
  const [app, setApp] = useState(binding?.app ?? ''), [panel, setPanel] = useState(binding?.panel ?? 'main');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [opened, setOpened] = useState(false);
  return <BlockFrame view={view} kind="appCanvas" title={<strong>{t('title')}</strong>}>
    <p className="notebook-note">{t('limits')}</p>
    {binding && <p>{binding.app} / {binding.panel} · {binding.id}</p>}
    {view.editor.isEditable && <div className="notebook-science-fields">
      <Field label={t('app')}>{control => <Input {...control} value={app} maxLength={128} onChange={event => setApp(event.target.value)} />}</Field>
      <Field label={t('panel')}>{control => <Input {...control} value={panel} maxLength={128} onChange={event => setPanel(event.target.value)} />}</Field>
      <Button onClick={() => { try { view.updateAttributes({ binding: parseAppCanvasBinding({ id: binding?.id ?? crypto.randomUUID(), app, panel }) }); setError(''); setOpened(false); } catch (cause) { setError(String(cause)); } }}>{t('bind')}</Button>
      <Button disabled={!binding} onClick={() => { view.updateAttributes({ binding: null }); setOpened(false); }}>{t('remove')}</Button>
    </div>}
    {binding && <Button busy={busy} onClick={async () => {
      setBusy(true); setError(''); setOpened(false);
      try { await requestAppShell('navigate', { path: appCanvasPath(binding) }); setOpened(true); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { setBusy(false); }
    }}>{t('open')}</Button>}
    {opened && <Feedback kind="info">{t('opened')}</Feedback>}{error && <Feedback kind="error">{error}</Feedback>}
  </BlockFrame>;
}
