import React, { useEffect, useMemo, useRef } from 'react';
import { ActionPortal } from './components.tsx';
import type { DirectoryEntry, Discovery } from './connector-types.ts';
import { errorMessage } from './error-message.ts';
import { Button as PointButton, Feedback, Textarea } from './ui';

const withArg = (args: string[] | undefined, flag: string, value: string) => (args ?? []).map(arg => arg.startsWith(`${flag}=`) ? `${flag}=${value}` : arg);

/** What Pero found on this machine for an engineering connector, and the one button that installs it. */
export function DiscoveryPanel({ actionsTarget, locale, provider, discovery, definition, busy, installing, onPick, onRetry, onManual, onInstall, onDocs, onInstallServer, onCancelInstall }: {
  actionsTarget?: HTMLElement | null; locale: 'zh' | 'en'; provider: DirectoryEntry; discovery: Discovery; definition: any; busy: boolean; installing: boolean;
  onPick: (patch: Record<string, any>) => void; onRetry: () => void; onManual: () => void; onInstall: () => void; onDocs: () => void; onInstallServer: () => void; onCancelInstall: () => void;
}) {
  const copy = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const spec = provider.discovery!;
  const isFeishu = provider.providerId === 'feishu-workspace';
  const job = discovery.install;
  const running = discovery.state === 'running' || discovery.state === 'idle';
  const argValue = (flag: string) => (definition?.args ?? []).find((arg: string) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1) ?? '';
  const command = discovery.command.find(c => c.path === definition?.command) ?? (provider.providerId === 'feishu-workspace' ? discovery.command[0] : undefined);
  const rows: { key: string; label: string; ok: boolean; value?: React.ReactNode; missing: React.ReactNode }[] = [{
    key: 'command', label: isFeishu ? copy('运行环境', 'Runtime') : copy('服务程序', 'Server executable'), ok: !!command?.executable,
    value: isFeishu ? copy('已就绪', 'Ready') : discovery.command.length > 1
      ? <select aria-label={copy('服务程序', 'Server executable')} value={definition?.command ?? ''} onChange={e => { const pick = discovery.command.find(c => c.path === e.target.value); if (pick) onPick({ command: pick.path, sha256: pick.sha256 }); }}>
          {discovery.command.map(c => <option key={c.path} value={c.path}>{c.path}</option>)}
        </select>
      : command && <code>{command.path}</code>,
    missing: isFeishu ? copy('Pero 运行环境不可用，请修复或更新应用。', 'Pero runtime unavailable. Repair or update the app.') : command && !command.executable
      ? <>{copy('找到', 'Found')} <code>{command.path}</code>{copy('，但没有执行权限：', ', but it is not executable: ')}<code>chmod +x "{command.path}"</code></>
      : discovery.installable
        ? <>{copy(`未找到 ${spec.executables[0]}。`, `${spec.executables[0]} was not found. `)}
            <span className="point-connectors-discovery-note">{job?.state === 'running' ? <>{copy('正在后台安装…', 'Installing in the background…')} <PointButton type="button" className="point-connectors-link" onClick={onCancelInstall}>{copy('取消', 'Cancel')}</PointButton></> : job?.state === 'failed' ? copy('安装失败', 'Install failed') : job?.state === 'cancelled' ? copy('已取消', 'Cancelled') : <>{copy('将执行：', 'Command: ')}{discovery.installSummary}</>}</span>
            {job?.log && <details className="point-connectors-install-details" open={job.state === 'failed'}><summary>{copy('安装日志', 'Install log')}</summary><pre className="point-connectors-install-log">{job.log}</pre></details>}</>
      : provider.installHint?.startsWith('https://')
        ? <>{copy(`未找到 ${spec.executables[0]}。`, `${spec.executables[0]} was not found. `)}<PointButton type="button" className="point-connectors-link" onClick={onDocs}>{copy('查看安装文档', 'View installation docs')}</PointButton></>
        : <>{copy(`未找到 ${spec.executables[0]}。在终端运行`, `${spec.executables[0]} was not found. Run in a terminal:`)} <code>{provider.installHint}</code> {copy('然后点“重新检测”。', 'Then check again.')}</>,
  }];
  if (provider.providerId.startsWith('science-')) rows.push({
    key: 'scienceRuntime', label: 'Claude Science', ok: !discovery.setupError && !!definition?.env?.POINT_SCIENCE_SOURCE_SHA256,
    value: <code>0.1.60-release</code>,
    missing: <>{copy('未找到兼容服务或 Pero 适配器。', 'Compatible servers or the Pero adapter were not found.')} <code>{discovery.setupError}</code> <PointButton type="button" className="point-connectors-link" onClick={onDocs}>{copy('查看安装文档', 'View installation docs')}</PointButton></>,
  });
  if (provider.providerId === 'feishu-workspace') {
    rows.push({ key: 'feishuCli', label: copy('飞书 CLI', 'Feishu CLI'), ok: !!discovery.nativeCli?.length,
      value: copy('已就绪', 'Ready'), missing: copy('请先安装官方飞书 CLI，再重新检测。', 'Install the official Feishu CLI, then check again.') });
    rows.push({ key: 'feishuAccount', label: copy('授权账号', 'Authorized account'), ok: !!discovery.account && !!definition,
      value: discovery.account?.userName,
      missing: discovery.setupError === 'FEISHU_BUNDLE_MISSING'
        ? copy('Pero 服务组件不可用，请更新 Pero 后重试。', 'The Pero service component is unavailable. Update Pero and retry.')
        : copy('请在官方 CLI 的 point-readonly 配置中完成文档搜索、读取授权，再重新检测。', 'Authorize document search and read in the official CLI point-readonly profile, then check again.') });
  }
  if (spec.matlabRoot) rows.push({
    key: 'matlabRoot', label: 'MATLAB', ok: !!argValue('--matlab-root'),
    value: discovery.matlabRoot.length > 1
      ? <select aria-label="MATLAB" value={argValue('--matlab-root')} onChange={e => onPick({ args: withArg(definition?.args, '--matlab-root', e.target.value) })}>
          {discovery.matlabRoot.map(root => <option key={root} value={root}>{root.split('/').pop()}</option>)}
        </select>
      : <code>{argValue('--matlab-root').split('/').pop()}</code>,
    missing: <>{copy('未在“应用程序”中找到 MATLAB（MATLAB_R20xxx.app）。', 'MATLAB (MATLAB_R20xxx.app) was not found in Applications.')}</>,
  });
  if (spec.extensionFile) rows.push({
    key: 'extensionFile', label: copy('Simulink 工具包', 'Simulink toolkit'), ok: !!argValue('--extension-file'),
    value: <code>{argValue('--extension-file')}</code>,
    missing: <>{copy('未找到 Simulink Agentic Toolkit。把它解压到主目录、“文稿”或“下载”文件夹后点“重新检测”。', 'Simulink Agentic Toolkit was not found. Extract it into Home, Documents or Downloads, then check again.')}</>,
  });
  const ready = !running && rows.every(row => row.ok);
  // One primary action: install the server first when it is the only thing missing, then add the connector.
  const installServerFirst = !!discovery.installable && !command?.executable;
  // One "Install" click covers both steps: once the server it installed is found,
  // add the connection (still through the Host's own approval) exactly once.
  const continued = useRef(false);
  useEffect(() => {
    if (!discovery.continueAfterInstall) { continued.current = false; return; }
    if (ready && !busy && !installing && !continued.current) { continued.current = true; onInstall(); }
  }, [discovery.continueAfterInstall, ready, busy, installing, onInstall]);
  return <section className="point-connectors-discovery" aria-busy={running}>
    <h3>{running ? copy('正在检测本机环境…', 'Checking this computer…') : ready ? copy('已在本机找到所需组件', 'Required components found') : copy('还缺少以下组件', 'Missing components')}</h3>
    {discovery.state === 'failed' && <Feedback kind="error" unstyled className="point-error">{isFeishu ? copy('检测失败，请重试。', 'Detection failed. Please retry.') : copy('检测失败，可以重试或改为手动配置。', 'Detection failed. Retry or configure manually.')}</Feedback>}
    {discovery.installError && <Feedback kind="error" unstyled className="point-error">{discovery.installError}</Feedback>}
    {!running && <ul>
      {rows.map(row => <li key={row.key} data-ok={row.ok}>
        <span className="point-connectors-discovery-mark" aria-hidden="true">{row.ok ? '✓' : '!'}</span>
        <span className="point-connectors-discovery-label">{row.label}</span>
        <span className="point-connectors-discovery-value">{row.ok ? row.value : row.missing}</span>
      </li>)}
    </ul>}
    <ActionPortal target={actionsTarget}><div className="point-connectors-actions">
      <PointButton variant="primary" type="button" disabled={busy || (ready ? false : !installServerFirst || running || discovery.state === 'preparing' || job?.state === 'running')} onClick={ready ? onInstall : onInstallServer}>{installing || job?.state === 'running' || discovery.state === 'preparing' ? copy('正在安装…', 'Installing…') : job?.state === 'failed' && !ready ? copy('重试安装', 'Retry install') : copy('安装', 'Install')}</PointButton>
      <PointButton type="button" disabled={running || busy} onClick={onRetry}>{copy('重新检测', 'Check again')}</PointButton>
      {!isFeishu && <PointButton type="button" className="point-connectors-link" disabled={busy} onClick={onManual}>{copy('手动配置', 'Configure manually')}</PointButton>}
    </div></ActionPortal>
    {ready && <p className="point-connectors-hint">{copy(`将允许 ${(provider.defaultTools ?? provider.operations ?? []).length} 个工具。`, `${(provider.defaultTools ?? provider.operations ?? []).length} tools will be allowed.`)}</p>}
  </section>;
}
/** Locates a JSON.parse failure so the editor can point at the line instead of repeating V8's message. */
export function jsonProblem(text: string): { line?: number; column?: number } | null {
  if (!text.trim()) return null;
  try { JSON.parse(text); return null; } catch (e) {
    const message = errorMessage(e);
    const lineColumn = /line (\d+) column (\d+)/.exec(message);
    if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) };
    const position = /position (\d+)/.exec(message);
    if (!position) return {};
    const before = text.slice(0, Number(position[1])).split('\n');
    return { line: before.length, column: before[before.length - 1].length + 1 };
  }
}

/** A plain textarea with the few affordances pasted MCP config needs: line numbers, Tab indent, live syntax position and a formatter. */
export function JsonEditor({ id, value, onChange, rows = 14, invalid, placeholder, locale = 'zh', actions }: {
  id?: string; value: string; onChange: (next: string) => void; rows?: number; invalid?: boolean; placeholder?: string; locale?: 'zh' | 'en';
  /** Extra commands that act on the editor text, beside Format. */
  actions?: React.ReactNode;
}) {
  const copy = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const gutter = useRef<HTMLDivElement>(null);
  const problem = useMemo(() => jsonProblem(value), [value]);
  const lineCount = Math.max(value.split('\n').length, rows);
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    const element = e.currentTarget, start = element.selectionStart, end = element.selectionEnd;
    onChange(value.slice(0, start) + '  ' + value.slice(end));
    requestAnimationFrame(() => { element.selectionStart = element.selectionEnd = start + 2; });
  };
  const format = () => { try { onChange(JSON.stringify(JSON.parse(value), null, 2)); } catch { /* status line already explains */ } };
  return <div className="point-connectors-json" data-invalid={!!problem || !!invalid} style={{ '--rows': rows } as React.CSSProperties}>
    <div className="point-connectors-json-body">
      <div className="point-connectors-json-gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, index) => <span key={index} data-error={problem?.line === index + 1 || undefined}>{index + 1}</span>)}
      </div>
      <Textarea id={id} value={value} wrap="off" spellCheck={false} autoCapitalize="off" autoComplete="off" placeholder={placeholder}
        aria-label={copy('JSON 配置', 'JSON configuration')} aria-invalid={!!problem || !!invalid || undefined} onKeyDown={onKeyDown} onChange={e => onChange(e.target.value)}
        onScroll={e => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }} />
    </div>
    <div className="point-connectors-json-status">
      <span data-state={!value.trim() ? 'empty' : problem ? 'error' : 'ok'}>
        {!value.trim() ? copy('等待粘贴 JSON', 'Paste JSON here') : problem ? (problem.line ? copy(`第 ${problem.line} 行第 ${problem.column} 列附近有语法错误`, `Syntax error near line ${problem.line}, column ${problem.column}`) : copy('JSON 语法错误', 'JSON syntax error')) : copy('JSON 格式正确', 'Valid JSON')}
      </span>
      <span className="point-connectors-json-actions">
        {actions}
        <PointButton type="button" disabled={!!problem || !value.trim()} onClick={format}>{copy('格式化', 'Format')}</PointButton>
      </span>
    </div>
  </div>;
}
