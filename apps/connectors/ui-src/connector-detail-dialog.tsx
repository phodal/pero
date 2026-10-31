import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Menu, type MenuEntry } from './components.tsx';
import { StatusBadge } from './components.tsx';
import { Dialog } from './components.tsx';
import { DiscoveryPanel, JsonEditor } from './connector-editor.tsx';
import { ConnectorCredentials, ConnectorField, ConnectorSection, ConnectorToolAccess } from './connector-detail-sections.tsx';
import { FeishuAuthorizationPanel } from './feishu-authorization-panel.tsx';
import { feishuMessage } from './feishu-recovery.mjs';
import { researchFields, secretReferences } from './connector-definition.mjs';
import type { ConnectorDetailController } from './use-connector-detail.ts';
import type { ConnectionView, ScopeGroup } from './connector-types.ts';
import {
  STATE_LABELS, STATE_LABELS_EN, ACTION_LABELS, ACTION_LABELS_EN, cardTitle, explain,
} from './shared/connection-copy.mjs';
import { Button as PointButton, Feedback, InfoTip, Input, Tabs, TabsContent, TabsList, TabsTrigger } from './ui';


export const PROVIDER_NAMES_EN: Record<string, string> = {
  'feishu-workspace': 'Feishu workspace',
  'local-process': 'Local process · stdio', 'remote-oauth': 'Remote MCP service · OAuth',
  'remote-token': 'Remote MCP service · token', 'point-builtin': 'Pero built-in services',
};
/** Title badge tone; only states that need the user's action keep their explanation in the body. */
const STATE_TONES: Record<string, 'success' | 'progress' | 'error' | 'neutral'> = {
  connected: 'success', verified: 'success', 'waiting-for-approval': 'progress', connecting: 'progress',
  'needs-attention': 'error', 'needs-authorization': 'error', 'needs-configuration': 'error',
};
export function StatusDot({ state }: { state: string }) { return <span className="point-connectors-dot" data-state={state} aria-hidden="true" />; }

type Props = {
  configurationRequest?: number;
  detail: ConnectorDetailController; locale: 'zh' | 'en';
  activity: { busy: string; notice: string; noticeError: boolean };
  toolSelection: Set<string>; setToolSelection: React.Dispatch<React.SetStateAction<Set<string>>>;
  actions: {
    save: () => void; importPasted: () => void; saveSecret: () => void; deleteSecret: () => void; saveTools: () => void;
    perform: (action: string, target?: ConnectionView | null) => void; onDocs: (providerId: string) => void;
  };
};

/** Presentation only: workflow state comes from the controller; commands go
 * through callbacks to the existing Host-owned connector operations. */
export function ConnectorDetailDialog({ configurationRequest = 0, detail, locale, activity, toolSelection, setToolSelection, actions }: Props) {
  const copy = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const { busy, notice, noticeError } = activity;
  const { save, importPasted, saveSecret, deleteSecret, saveTools, perform, onDocs } = actions;
  const { view, provider, isDirty, quickInstall, discover, discovery, parsedDefinition,
    patchDefinition, useManual, installServer, cancelInstall, fieldError, managedProvider, connectorIdField, setConnectorIdField,
    editMode, setEditMode, definitionText, setDefinitionText,
    secretReference, setSecretReference, secretValue, setSecretValue, closeDetail } = detail;
  const [actionTarget, setActionTarget] = useState<HTMLDivElement | null>(null);
  const isFeishu = provider?.providerId === 'feishu-workspace';
  const editable = !quickInstall && !isFeishu;
  const configuration = useRef<HTMLDivElement>(null);
  const runtime = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!configurationRequest) return;
    const target = isFeishu ? runtime.current : configuration.current;
    if (!target) return;
    if (isFeishu) runtime.current!.open = true;
    target.scrollIntoView?.({ block: 'nearest' });
    const control = [...target.querySelectorAll<HTMLElement>('input:not([disabled]):not([readonly]),textarea:not([disabled]),summary')]
      .find(node => !node.closest('[hidden],[data-state="inactive"]'));
    (control ?? target).focus();
  }, [configurationRequest, isFeishu]);
  const scopeEffects: ScopeGroup[] = view?.scope?.effects ?? (provider?.operations ?? []).reduce((groups: ScopeGroup[], op) => {
    const group = groups.find(g => g.effect === op.effect);
    if (group) group.tools.push(op.tool); else groups.push({ effect: op.effect, tools: [op.tool] });
    return groups;
  }, []);
  const admittedTools = new Set([...(view?.tools.usable ?? []), ...(view?.tools.blocked ?? []).filter(t => t.reason !== 'not-host-allowed').map(t => t.name)]);
  const toolsChanged = toolSelection.size !== admittedTools.size || [...toolSelection].some(t => !admittedTools.has(t));
  const references = useMemo(() => secretReferences(parsedDefinition), [parsedDefinition]);
  // The credential row follows the definition: renaming a secretRef in JSON retargets it.
  useEffect(() => {
    if (editable && references.length && !references.includes(secretReference)) setSecretReference(references[0]);
  }, [editable, references, secretReference, setSecretReference]);
  const labels = locale === 'en' ? ACTION_LABELS_EN : ACTION_LABELS;
  const moreActions: MenuEntry[] = view ? [...view.secondary, ...view.lifecycle].map(action => ({
    label: labels[action] ?? action, danger: action === 'remove', disabled: !!busy, onSelect: () => perform(action),
  })) : [];
  if (provider?.discovery && !quickInstall) moreActions.unshift({ label: copy('重新检测运行环境', 'Detect runtime again'), disabled: !!busy || discovery.state === 'running', onSelect: () => void discover(provider.providerId) });
  const errorFor = (field: string) => fieldError?.field === field ? fieldError.message : undefined;
  const text = (zh?: string, en?: string) => locale === 'en' ? en ?? zh : zh;
  // Provider description and prerequisites are reference, not steps: one help icon beside the title.
  const about = isFeishu ? '' : [text(provider?.summary, provider?.summaryEn), text(provider?.prerequisiteCopy, provider?.prerequisiteEn)]
    .map(part => part?.trim()).filter(Boolean).map(part => /[。.！!？?]$/.test(part!) ? part : `${part}${copy('。', '.')}`).join(locale === 'zh' ? '' : ' ');
  const status = view && !isFeishu ? explain(view, locale) : '';
  const gotcha = !isFeishu ? text(provider?.gotchaCopy, provider?.gotchaEn) : undefined;
  const help = [STATE_TONES[view?.state ?? ''] === 'error' ? '' : status, about, gotcha, view && !isFeishu ? [view.connectionId, view.origin].filter(Boolean).join(' · ') : ''].filter(Boolean).join('\n');
  const name = isFeishu ? copy('飞书连接', 'Feishu connection') : view ? cardTitle(view) : (locale === 'en' ? PROVIDER_NAMES_EN[provider?.providerId ?? ''] : undefined) ?? provider?.displayName ?? copy('自定义连接', 'Custom connection');
  const formAvailable = !!parsedDefinition;
  const researchKeys = new Set((researchFields[provider?.providerId ?? ''] ?? []).map(field => field.key));
  const tab = formAvailable && editMode !== 'json' ? 'form' : 'json';
  return <Dialog className={`point-connector-detail${isFeishu ? ' point-feishu-connection' : ''}`} title={help ? <span className="point-connector-title">{name}
        {view && !isFeishu && <StatusBadge className="point-connector-state" state={STATE_TONES[view.state] ?? 'neutral'} dotClassName="point-connector-state-dot">
          <span role="status">{(locale === 'en' ? STATE_LABELS_EN : STATE_LABELS)[view.state] ?? view.state}</span>
        </StatusBadge>}
        <InfoTip align="start" label={copy('说明', 'About')} text={help} /></span> : name} size="lg" closeLabel={copy('关闭', 'Close')} onClose={() => closeDetail()}
      /* Default focus would land on the ⓘ trigger and pop its tip open on every open. */
      initialFocus=".point-dialog-foot button:not([aria-haspopup])"
      footerStart={<>
        {moreActions.length > 0 && <Menu label={copy('更多', 'More')} triggerVariant="label" items={moreActions} />}
        {isDirty ? <span className="point-connectors-hint">{copy('有未保存的更改', 'Unsaved changes')}</span>
          : view && !view.sealed && toolsChanged && <span className="point-connectors-hint">{copy(`将允许 ${toolSelection.size} 个工具`, `${toolSelection.size} tools selected`)}</span>}
      </>}
      footer={<>
        <PointButton onClick={() => closeDetail()} disabled={!!busy}>{copy('关闭', 'Close')}</PointButton>
        {view && !view.sealed && toolsChanged && <PointButton disabled={!!busy} onClick={saveTools}>{copy('保存工具权限', 'Save tool access')}</PointButton>}
        {!quickInstall && (!view || isDirty) && <PointButton variant="primary" disabled={!!busy || !!view?.sealed} onClick={save}>{busy === 'put' ? copy('正在保存…', 'Saving…') : isFeishu ? copy('应用检测结果', 'Apply detected configuration') : copy('保存配置', 'Save configuration')}</PointButton>}
        {view?.primary && <PointButton disabled={!!busy} onClick={() => perform(view.primary)}>{labels[view.primary] ?? view.primary}</PointButton>}
        <div className="point-connector-action-slot" ref={setActionTarget} />
      </>}>
      {notice && <Feedback kind={noticeError ? 'error' : 'status'} unstyled className={noticeError ? 'point-error' : 'point-connectors-notice'}>{notice}</Feedback>}
      {view && !isFeishu && STATE_TONES[view.state] === 'error' && <Feedback kind="error" unstyled className="point-connectors-warning">{status}</Feedback>}
      {view && isFeishu && <FeishuAuthorizationPanel key={view.connectionId} connectionId={view.connectionId} locale={locale} actionsTarget={actionTarget} connectionState={view.state} connectionSummary={explain(view, locale)} onAuthorized={() => void discover('feishu-workspace')}/>}

      {quickInstall && <DiscoveryPanel actionsTarget={actionTarget} locale={locale} provider={provider!} discovery={discovery} definition={parsedDefinition} busy={!!busy}
        onPick={patchDefinition} onRetry={() => void discover(provider!.providerId)} onManual={useManual}
        onInstall={save} installing={busy === 'put'} onDocs={() => onDocs(provider!.providerId)} onInstallServer={() => void installServer(provider!.providerId)} onCancelInstall={cancelInstall} />}
      {fieldError && (quickInstall || isFeishu) && <Feedback kind="error" unstyled className="point-error">{fieldError.message}</Feedback>}

      {view && <ConnectorToolAccess view={view} scopeEffects={scopeEffects} selection={toolSelection} disabled={!!view.sealed || !!busy} locale={locale}
        title={isFeishu ? copy('Pero 工具权限', 'Pero tool access') : undefined}
        note={isFeishu ? copy('飞书授权不会自动启用 Pero 工具。', 'Feishu consent does not enable tools in Pero.') : undefined}
        onToggle={(tool, allowed) => setToolSelection(prev => { const next = new Set(prev); allowed ? next.add(tool) : next.delete(tool); return next; })} />}

      {editable && <div ref={configuration} tabIndex={-1}><Tabs value={tab} onValueChange={next => setEditMode(next as 'form' | 'json')}>
        <ConnectorSection title={copy('连接配置', 'Configuration')} aside={<TabsList aria-label={copy('编辑方式', 'Editing mode')}>
          <TabsTrigger value="form" disabled={!formAvailable}>{copy('表单', 'Form')}</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>}>
          <fieldset className="point-connector-form" disabled={!!busy || !!view?.sealed}>
            {!view && <ConnectorField id="connector-id" label={copy('连接 ID', 'Connection ID')} error={errorFor('id')}>{control =>
              <Input {...control} value={connectorIdField} onChange={e => setConnectorIdField(e.target.value)} placeholder={copy('例如 my-gitlab', 'e.g. my-gitlab')} />
            }</ConnectorField>}
            <TabsContent value="form" className="point-connector-fields">
              {parsedDefinition && ['http', 'gitlab', 'github', 'linear', 'microsoft365', 'gmail'].includes(parsedDefinition.transport) && <ConnectorField id="endpoint" label={copy('接入地址', 'Endpoint')} error={errorFor('endpoint')}>{control =>
                <Input {...control} value={parsedDefinition.url ?? ''} readOnly={managedProvider} onChange={e => patchDefinition({ url: e.target.value })} />
              }</ConnectorField>}
              {parsedDefinition?.oauth && 'clientId' in parsedDefinition.oauth && <ConnectorField id="oauth-client-id"
                label={parsedDefinition.transport === 'gmail' ? copy('Google 客户端 ID', 'Google client ID') : parsedDefinition.transport === 'microsoft365' ? copy('Entra 客户端 ID', 'Entra client ID') : copy('OAuth 客户端 ID', 'OAuth client ID')}
                description={parsedDefinition.transport === 'gmail' ? copy('只读。Pulse 会把昨日邮件的部分正文交给当前模型生成摘要。', 'Read-only. Pulse sends bounded text from yesterday’s mail to your selected model for summaries.') : undefined}>{control =>
                <Input {...control} value={parsedDefinition.oauth.clientId ?? ''} spellCheck={false} autoComplete="off"
                  onChange={e => patchDefinition({ oauth: { ...parsedDefinition.oauth, clientId: e.target.value.trim() } })} />
              }</ConnectorField>}
              {parsedDefinition?.transport === 'stdio' && <>
                <ConnectorField id="command" label={copy('启动命令', 'Executable')} error={errorFor('command')}>{control => <Input {...control} value={parsedDefinition.command ?? ''} placeholder={copy('绝对路径', 'Absolute path')} spellCheck={false} onChange={e => patchDefinition({ command: e.target.value })} />}</ConnectorField>
                <ConnectorField id="sha256" label="SHA-256" error={errorFor('sha256')}>{control => <Input {...control} value={parsedDefinition.sha256 ?? ''} placeholder={copy('可执行文件摘要', 'Executable digest')} spellCheck={false} onChange={e => patchDefinition({ sha256: e.target.value })} />}</ConnectorField>
                <ConnectorField id="cwd" label={copy('工作目录', 'Working directory')}>{control => <Input {...control} value={parsedDefinition.cwd ?? ''} placeholder={copy('可选', 'Optional')} spellCheck={false} onChange={e => patchDefinition({ cwd: e.target.value || undefined })} />}</ConnectorField>
              </>}
              {!!provider && (researchFields[provider.providerId] ?? []).map(field => <ConnectorField key={field.key} id={field.key} label={copy(field.zh, field.en)} error={errorFor(field.key)}>{control =>
                <Input {...control} value={typeof parsedDefinition?.env?.[field.key] === 'string' ? parsedDefinition.env[field.key] : ''}
                  onChange={e => patchDefinition({ env: { ...parsedDefinition?.env, [field.key]: e.target.value } })} />
              }</ConnectorField>)}
              {Object.entries(parsedDefinition?.env ?? {}).filter(([key, value]) => typeof value === 'string' && !researchKeys.has(key)).map(([key, value]) =>
                <ConnectorField key={key} id={`env-${key}`} label={<code>{key}</code>}>{control =>
                  <Input {...control} value={value as string} spellCheck={false} onChange={e => patchDefinition({ env: { ...parsedDefinition.env, [key]: e.target.value } })} />
                }</ConnectorField>)}
              {!!provider?.discovery && !!researchFields[provider.providerId] && <div className="point-connectors-actions">
                <code>{provider.installHint}</code>
                {discovery.state === 'failed' && <span role="alert">{copy('检测失败，请重试。', 'Detection failed. Please retry.')}</span>}
                {discovery.state === 'done' && !discovery.command.length && <span role="status">{copy('未找到程序；安装后重新检测，或填写路径和 SHA-256。', 'Executable not found. Install and check again, or enter its path and SHA-256.')}</span>}
              </div>}
              {!view && !managedProvider && <ConnectorField id="tools" label={copy('允许的工具', 'Allowed tools')} error={errorFor('tools')}>{control =>
                <Input {...control} value={Array.isArray(parsedDefinition?.tools) ? parsedDefinition.tools.join(', ') : ''} placeholder={copy('逗号分隔；留空则不允许任何工具', 'Comma separated; empty allows none')}
                  onChange={e => patchDefinition({ tools: e.target.value.split(/[,，\n]/).map(s => s.trim()).filter(Boolean) })} />
              }</ConnectorField>}
            </TabsContent>
            <TabsContent value="json">
              <JsonEditor locale={locale} value={definitionText} onChange={setDefinitionText} rows={12} invalid={fieldError?.field === 'json'}
                actions={!view && <PointButton type="button" disabled={!!busy} onClick={importPasted}>{copy('导入 JSON', 'Import JSON')}</PointButton>} />
              {errorFor('json') && <Feedback kind="error" unstyled className="point-error">{errorFor('json')}</Feedback>}
            </TabsContent>
          </fieldset>
        </ConnectorSection>
      </Tabs></div>}

      {editable && references.length > 0 && <ConnectorCredentials references={references} reference={secretReference} onReference={setSecretReference}
        value={secretValue} onValue={setSecretValue} onSave={saveSecret} onDelete={deleteSecret} busy={!!busy || !!view?.sealed} providerId={provider?.providerId} locale={locale} />}

      {isFeishu && <details ref={runtime} className="point-connectors-advanced" {...(fieldError ? { open: true } : {})}>
        <summary>{copy('运行环境', 'Runtime')}</summary>
        {discovery.state === 'done' && <Feedback kind={discovery.account && !discovery.setupError ? 'status' : 'error'}>{discovery.account && !discovery.setupError
          ? copy('账号与组件已核验，可以应用检测结果。', 'Account and tools verified. You can apply the detected configuration.')
          : feishuMessage(discovery.setupError ?? 'FEISHU_AUTH_REQUIRED', locale)}</Feedback>}
        {parsedDefinition?.command && <dl className="point-feishu-runtime-details">
          <dt>{copy('启动程序', 'Executable')}</dt><dd>{parsedDefinition.command}</dd>
          <dt>{copy('飞书 CLI', 'Feishu CLI')}</dt><dd>{parsedDefinition.env?.POINT_FEISHU_CLI ?? '—'}</dd>
        </dl>}
      </details>}
    </Dialog>;
}
