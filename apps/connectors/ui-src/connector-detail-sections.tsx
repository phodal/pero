import React from 'react';
import { Button as PointButton, Field, InfoTip, Input, Select } from './ui';
import type { ConnectionView, ScopeGroup } from './connector-types.ts';
import {
  BLOCK_REASON_LABELS, BLOCK_REASON_LABELS_EN, EFFECT_LABELS, EFFECT_LABELS_EN, toolSummary,
} from './shared/connection-copy.mjs';

type Locale = 'zh' | 'en';
const pick = (locale: Locale) => (zh: string, en: string) => locale === 'zh' ? zh : en;

/** Flat titled block; `aside` sits on the heading row (counts, tabs, help). */
export function ConnectorSection({ title, aside, children, className }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={['point-connector-section', className].filter(Boolean).join(' ')}>
    <header className="point-connector-section-head"><h3>{title}</h3>{aside}</header>
    {children}
  </section>;
}

/** Label beside control on wide dialogs, stacked when narrow. */
export function ConnectorField({ id, label, description, error, children }: { id: string; label: React.ReactNode; description?: React.ReactNode; error?: string; children: (control: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => React.ReactNode }) {
  return <Field className="point-connector-field" controlId={id} label={label} description={description} error={error}>{children}</Field>;
}

/** One tool list grouped by effect, replacing the separate scope card and allowlist disclosure. */
export function ConnectorToolAccess({ view, scopeEffects, selection, onToggle, disabled, locale, title, note }: {
  view: ConnectionView; title?: string; scopeEffects: ScopeGroup[]; selection: Set<string>; onToggle: (tool: string, allowed: boolean) => void;
  disabled: boolean; locale: Locale; note?: string;
}) {
  const copy = pick(locale);
  const effectLabels = locale === 'en' ? EFFECT_LABELS_EN : EFFECT_LABELS;
  const reasonLabels = locale === 'en' ? BLOCK_REASON_LABELS_EN : BLOCK_REASON_LABELS;
  const rows = [...view.tools.usable.map(name => ({ name, reason: undefined as string | undefined })), ...view.tools.blocked];
  const reasonOf = new Map(rows.map(row => [row.name, row.reason]));
  const grouped = new Set(scopeEffects.flatMap(group => group.tools));
  const groups = rows.length
    ? [...scopeEffects.map(group => ({ label: effectLabels[group.effect] ?? group.effect, tools: group.tools.filter(tool => reasonOf.has(tool)) })),
      { label: copy('其他', 'Other'), tools: rows.map(row => row.name).filter(name => !grouped.has(name)) }].filter(group => group.tools.length)
    : scopeEffects.map(group => ({ label: effectLabels[group.effect] ?? group.effect, tools: group.tools }));
  const idle = view.state === 'verified' || view.state === 'connected';
  return <ConnectorSection title={title ?? copy('工具', 'Tools')} aside={<span className="point-connector-section-meta">{toolSummary(view.tools, locale)}</span>}>
    {note && <p className="point-connectors-hint">{note}</p>}
    {groups.map(group => <div key={group.label} className="point-connector-tool-group">
      <span className="point-connector-tool-effect">{group.label}</span>
      <div className="point-connector-tool-list">{group.tools.map(tool => {
        const reason = reasonOf.get(tool);
        if (!rows.length) return <code key={tool} className="point-connector-tool">{tool}</code>;
        const forced = !!reason && reason !== 'not-host-allowed';
        return <label key={tool} className="point-connector-tool" data-checked={selection.has(tool)}>
          <input type="checkbox" checked={selection.has(tool)} disabled={disabled} onChange={e => onToggle(tool, e.target.checked)} />
          <code>{tool}</code>
          {forced && <span className="point-connectors-reason">{reasonLabels[reason!] ?? reason}</span>}
        </label>;
      })}</div>
    </div>)}
    {!rows.length && <p className="point-connectors-hint">{idle ? copy('这个服务没有提供工具。', 'This service offers no tools.') : copy('验证连接后可选择工具。', 'Verify the connection to choose tools.')}</p>}
    {view.scope?.missingScopes?.length ? <p className="point-connectors-warning">{copy('当前授权未覆盖建议权限：', 'Consent does not cover the recommended scopes: ')}{view.scope.missingScopes.join(', ')}</p> : null}
  </ConnectorSection>;
}

const SECRET_PLACEHOLDERS: Record<string, [string, string]> = {
  wandb: ['Bearer <API key>', 'Bearer <API key>'],
  galaxy: ['API key，不加 Bearer', 'API key, without Bearer'],
  jupyter: ['Token，不加 Bearer', 'Token, without Bearer'],
};

/** OS credential storage values for the `secretRef`s the definition already names; actions stay beside the field they act on. */
export function ConnectorCredentials({ references, reference, onReference, value, onValue, onSave, onDelete, busy, providerId, locale }: {
  references: string[]; reference: string; onReference: (next: string) => void; value: string; onValue: (next: string) => void;
  onSave: () => void; onDelete: () => void; busy: boolean; providerId?: string; locale: Locale;
}) {
  const copy = pick(locale);
  const placeholder = SECRET_PLACEHOLDERS[providerId ?? ''];
  return <ConnectorSection title={copy('凭据', 'Credentials')} aside={<InfoTip align="end" label={copy('关于凭据', 'About credentials')}
    text={copy('值由系统加密保存，保存后不再显示。同名引用由多个连接共享，删除会影响全部使用它的连接。', 'Values use OS encryption and are hidden after saving. Connections sharing a reference share its value; deleting it affects all of them.')} />}>
    <div className="point-connector-secret">
      {references.length > 1
        ? <Select label={copy('引用名', 'Reference name')} value={reference} onChange={onReference} disabled={busy} options={references.map(ref => ({ value: ref, label: ref }))} />
        : <code title={copy('引用名', 'Reference name')}>{reference}</code>}
      <Input type="password" autoComplete="new-password" aria-label={copy('密钥值', 'Secret value')} value={value} disabled={busy}
        placeholder={placeholder ? copy(...placeholder) : copy('输入新值', 'Enter a new value')} onChange={e => onValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && value && !busy) { e.preventDefault(); onSave(); } }} />
      <PointButton type="button" disabled={busy || !reference || !value} onClick={onSave}>{copy('保存', 'Save')}</PointButton>
      <PointButton type="button" variant="ghost" className="point-connector-secret-delete" disabled={busy || !reference} onClick={onDelete}>{copy('删除', 'Delete')}</PointButton>
    </div>
  </ConnectorSection>;
}
