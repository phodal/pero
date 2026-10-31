import { connectorRequest } from './bridge';
import React, { useEffect, useId, useRef, useState } from 'react';
import { Button, Checkbox, Feedback } from './ui';
import { FEISHU_CAPABILITY_SCOPES } from '../../../packages/connectors/src/connectors/feishu-workspace/capabilities.mjs';
import { STATE_LABELS, STATE_LABELS_EN } from './shared/connection-copy.mjs';
import { feishuMessage } from './feishu-recovery.mjs';
import { ActionPortal } from './components.tsx';
import type { Locale } from './bridge.ts';
import './feishu-authorization-panel.css';

import { FEISHU_CAPABILITY_LABELS as capabilitiesCopy } from '../../../packages/connectors/src/connectors/feishu-workspace/copy.mjs';
type Account = { userName?: string; openId: string; tenantId: string; scopes?: string[] };
type Attempt = { attemptId: string; authorizationUrl: string; qr: string };
type Props = { actionsTarget?: HTMLElement | null; connectionState?: string; connectionSummary?: string; connectionId: string; locale: Locale; onAuthorized?: () => void };

/** Account consent stays separate from Host tool admission. Switching connections
 * remounts the panel so an old authorization reply cannot affect a new account. */
export function FeishuAuthorizationPanel(props: Props) {
  return <AuthorizationPanel key={props.connectionId} {...props} />;
}
function AuthorizationPanel({ connectionId, locale, onAuthorized, actionsTarget, connectionState, connectionSummary }: Props) {
  const copy = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const id = useId();
  const alive = useRef(true);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountError, setAccountError] = useState('');
  const [revision, setRevision] = useState(0);
  const [checking, setChecking] = useState(true);
  const [capabilities, setCapabilities] = useState<string[]>(['documents']);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const request = async (payload: Record<string, unknown>) => {
    const reply = await connectorRequest({ connectorId: connectionId, ...payload });
    if (!reply?.ok) throw new Error(reply?.code ?? 'FEISHU_REQUEST');
    return reply.result;
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setAccount(null); setAccountError(''); setChecking(true);
    void request({ operation: 'feishu.workspace', input: { action: 'account' } })
      .then(result => { if (active) setAccount(result); })
      .catch(error => { if (active) setAccountError(error.message); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [connectionId, revision]);
  useEffect(() => {
    let active = true;
    void request({ operation: 'feishu.authorization', action: 'status' })
      .then(result => { if (active) setAttempt(result.attempt ?? null); })
      .catch(error => { if (active) setActionError(error.message); })
      .finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, [connectionId]);
  const act = async (action: 'begin' | 'finish' | 'cancel') => {
    if (busy || restoring) return;
    setBusy(true); setMessage(''); setActionError('');
    try {
      const result = await request({ operation: 'feishu.authorization', action,
        ...(action === 'begin' ? { capabilities } : action === 'finish' ? { attemptId: attempt?.attemptId } : {}) });
      if (!alive.current) return;
      if (action === 'begin') setAttempt(result);
      else {
        setAttempt(null);
        if (action === 'finish') { setRevision(value => value + 1); onAuthorized?.(); }
        setMessage(action === 'finish'
          ? copy('授权已完成。工具权限在连接设置中单独管理。', 'Consent completed. Tool access is managed separately in connection settings.')
          : copy('已取消本次授权。', 'Authorization cancelled.'));
      }
    } catch (error: any) { if (alive.current) setActionError(error.message); }
    finally { if (alive.current) setBusy(false); }
  };
  const error = actionError || accountError;
  const connectionLabel = (locale === 'en' ? STATE_LABELS_EN : STATE_LABELS)[connectionState ?? ''] ?? connectionState;
  return <section className="point-feishu-authorization" aria-labelledby={`${id}-title`}>
    <div className="point-feishu-account">
      <h3 id={`${id}-title`}>{copy('账号', 'Account')}</h3>
      <span role="status">{checking ? copy('正在核验…', 'Checking…') : account ? account.userName || account.openId : copy('未核验', 'Not verified')}{connectionState && <> · {connectionLabel}</>}</span>
      {actionError && <span role="alert">{feishuMessage(actionError, locale)}</span>}
    </div>
    {(error || connectionSummary) && <details className="point-feishu-diagnostics"><summary>{copy('诊断详情', 'Diagnostics')}</summary>
      {connectionSummary && <p>{connectionSummary}</p>}
      {error && <><p>{error === 'FEISHU_DESKTOP_REQUIRED' ? copy('需要本机 Pero Host 才能检查和授权。', 'The local Pero Host is required to check and authorize.') : feishuMessage(error, locale)}</p><code>{error}</code></>}
    </details>}
    <fieldset className="point-feishu-permissions" disabled={busy || restoring || !!attempt} aria-describedby={`${id}-hint`}>
      <legend>{copy('用户权限', 'User permissions')}</legend>
      <p id={`${id}-hint`}>{copy('勾选要申请的权限，右侧为当前授权状态。', 'Select permissions to request. Current consent is shown on the right.')}</p>
      <div className="point-feishu-permission-list">{capabilitiesCopy.map(([name, zh, en]) => {
        const granted = account && FEISHU_CAPABILITY_SCOPES[name].every((scope: string) => account.scopes?.includes(scope));
        return <label className="point-feishu-permission" key={name}>
          <Checkbox checked={capabilities.includes(name)} disabled={busy || restoring || !!attempt}
            aria-describedby={`${id}-${name}-state`}
            onCheckedChange={checked => setCapabilities(values => checked === true ? [...values, name] : values.filter(value => value !== name))} />
          <span>{copy(zh, en)}</span>
          <small id={`${id}-${name}-state`} data-granted={!!granted}>{!account ? copy('未核验', 'Unchecked') : granted ? copy('已授权', 'Granted') : copy('未授权', 'Not granted')}</small>
        </label>;
      })}</div>
    </fieldset>
    {attempt && <div className="point-feishu-auth-attempt">
      <img width={144} height={144} alt={copy('飞书授权二维码', 'Feishu authorization QR code')} src={attempt.qr} />
      <p>{copy('在飞书完成授权后，返回确认。', 'Complete consent in Feishu, then confirm here.')}</p>
    </div>}
    <ActionPortal target={actionsTarget}><div className="point-feishu-auth-actions">
      <Button disabled={checking || busy || restoring} onClick={() => { setActionError(''); setRevision(value => value + 1); }}>{copy('检查授权', 'Check consent')}</Button>
      {!attempt ? <Button variant="primary" disabled={busy || restoring || !capabilities.length} onClick={() => void act('begin')}>
        {busy ? copy('正在发起…', 'Starting…') : copy('前往飞书授权', 'Authorize in Feishu')}</Button>
        : <><a href={attempt.authorizationUrl} target="_blank" rel="noopener noreferrer">{copy('打开授权页面', 'Open authorization page')}</a>
          <Button variant="primary" disabled={busy} onClick={() => void act('finish')}>{copy('已完成授权', 'Authorization completed')}</Button>
          <Button disabled={busy} onClick={() => void act('cancel')}>{copy('取消授权', 'Cancel authorization')}</Button></>}
    </div></ActionPortal>
    {message && <Feedback>{message}</Feedback>}
    {account && <details className="point-feishu-diagnostics"><summary>{copy('账号详情', 'Account details')}</summary><dl><dt>{copy('用户', 'User')}</dt><dd>{account.openId}</dd><dt>{copy('租户', 'Tenant')}</dt><dd>{account.tenantId}</dd></dl></details>}
  </section>;
}
