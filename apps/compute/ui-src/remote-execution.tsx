import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadFile, useAppApi, useAppI18n, useAppObject, type AppMessages } from '@pero/app-sdk';
import { Badge, Button, ContentPane, ContentSection, EmptyIllustration, EmptyState, Feedback, Field, Icon, IconButton, Input, InspectorHeader, ListRow, LoadingSkeleton, MetadataList, Select, SkeletonText, Split, SplitPane, contentLayout, type MetadataItem } from '@pero/app-sdk/ui';
import type { Cluster } from './messages';

const messages: AppMessages = {
  title: { en: 'Remote execution', zh: '远程执行' },
  method: { en: 'Numerical quadrature', zh: '数值积分' },
  methodHelp: { en: 'Run the bundled CPU midpoint method for the integral of 4 / (1 + x²) from 0 to 1. Inputs and method are frozen before approval. The result is execution evidence; it does not certify a scientific model.', zh: '运行内置 CPU 中点积分法，计算 4 / (1 + x²) 在 0 到 1 的积分。提交前固定输入与方法。结果是执行证据，不代表科研模型验收通过。' },
  cluster: { en: 'Connection', zh: '连接配置' },
  chooseCluster: { en: 'Choose a saved connection', zh: '选择已保存的连接' },
  noClusters: { en: 'Add a connection first', zh: '先添加连接配置' },
  noClustersHelp: { en: 'Save an SSH workstation or Slurm login host in Clusters, then return here to probe access.', zh: '在“集群”中保存 SSH 工作站或 Slurm 登录主机，再返回此处探测连接。' },
  manage: { en: 'Manage connections', zh: '管理连接配置' },
  probe: { en: 'Probe connection', zh: '探测连接' },
  connected: { en: 'Connection verified', zh: '已验证连接' },
  connectionUnknown: { en: 'Not probed', zh: '尚未探测' },
  connectionHelp: { en: 'Host uses your system SSH configuration and agent. Set up known_hosts and non-interactive access outside the App; no password or key is sent to this page.', zh: 'Host 使用系统 SSH 配置与 agent。请先在系统中配置 known_hosts 与免交互访问；此页面不接收密码或密钥。' },
  platform: { en: 'Observed platform', zh: '观察到的平台' },
  python: { en: 'Observed Python', zh: '观察到的 Python' },
  samples: { en: 'Samples per repetition', zh: '每次采样数' },
  samplesHelp: { en: '1,000–10,000,000 midpoint samples.', zh: '1,000–10,000,000 个中点采样。' },
  repetitions: { en: 'Repetitions', zh: '重复次数' },
  repetitionsHelp: { en: '1–100,000 repetitions; larger inputs run longer.', zh: '1–100,000 次；输入越大，运行越久。' },
  prepare: { en: 'Prepare fixed inputs', zh: '准备并固定输入' },
  preparedHelp: { en: 'Review the frozen input, method digest and destination below, then explicitly approve submission. Preparing inputs does not start the calculation.', zh: '核对下方固定输入、方法摘要与目标目录，再明确批准提交。准备输入不会开始计算。' },
  approve: { en: 'Approve and submit', zh: '批准并提交' },
  observe: { en: 'Observe original execution', zh: '读取原执行状态' },
  cancel: { en: 'Request cancellation', zh: '请求取消' },
  collect: { en: 'Collect and save evidence', zh: '收集并保存证据' },
  refresh: { en: 'Refresh saved executions', zh: '刷新已保存执行' },
  loading: { en: 'Loading remote execution evidence…', zh: '正在读取远程执行证据…' },
  busy: { en: 'Waiting for Host…', zh: '正在等待 Host…' },
  unavailable: { en: 'Remote execution is unavailable in this Host.', zh: '当前 Host 无法提供远程执行。' },
  retained: { en: 'The previous observation is retained.', zh: '已保留上次观察。' },
  requestFailed: { en: 'The request failed. Refresh or observe the original execution to reconcile its state.', zh: '本次请求失败。请刷新或读取原执行状态进行核对。' },
  submissionUnknown: { en: 'The submission reply was lost. Refresh or observe this original attempt; do not submit another copy.', zh: '未收到提交回执。请刷新或读取这次原始尝试，不要重复提交。' },
  attempts: { en: 'Saved executions', zh: '已保存执行' },
  inputs: { en: 'Frozen inputs and destination', zh: '固定输入与目标' },
  id: { en: 'Attempt', zh: '尝试编号' },
  digest: { en: 'Approved input and method SHA-256', zh: '获准输入与方法 SHA-256' },
  directory: { en: 'Remote directory', zh: '远程目录' },
  host: { en: 'SSH host', zh: 'SSH 主机' },
  scheduler: { en: 'Execution path', zh: '执行路径' },
  use: { en: 'Environment Use', zh: '环境 Use' },
  resources: { en: 'Slurm submission constraints', zh: 'Slurm 提交约束' },
  resourceValue: { en: '1 CPU · 256 MiB · 600 s walltime', zh: '1 CPU · 256 MiB · 600 秒墙钟时间' },
  account: { en: 'Slurm account', zh: 'Slurm 账号' },
  partition: { en: 'Slurm partition', zh: 'Slurm 分区' },
  siteDefault: { en: 'Site default', zh: '站点默认值' },
  job: { en: 'Original Slurm job', zh: '原始 Slurm 作业' },
  exit: { en: 'Recorded exit code', zh: '记录的退出码' },
  logs: { en: 'Observed logs', zh: '观察到的日志' },
  noLogs: { en: 'No log bytes have been observed yet. Observe the original execution to update them.', zh: '尚未观察到日志内容。读取原执行状态可更新日志。' },
  outputs: { en: 'Collected evidence', zh: '已收集证据' },
  outputHelp: { en: 'These fixed references identify the bytes collected by Host. Copy a reference to retain it in your research record.', zh: '固定引用标识 Host 收集的原始字节。可复制引用并保存到研究记录。' },
  outputPending: { en: 'Outputs have not been collected. The remote directory is retained above; observe the original execution, then collect when it has stopped.', zh: '产物尚未收回。上方保留远程目录；请先读取原执行状态，确认停止后收集。' },
  outputMissing: { en: 'No output files were collected. Retained logs and the remote directory remain available for investigation.', zh: '未收集到产物文件。可使用保留的日志与远程目录继续检查。' },
  download: { en: 'Download original', zh: '下载原始产物' },
  copy: { en: 'Copy fixed reference', zh: '复制固定引用' },
  copied: { en: 'Fixed reference copied.', zh: '已复制固定引用。' },
  copyFailed: { en: 'Clipboard unavailable. The reference remains shown below.', zh: '剪贴板不可用，固定引用仍显示在下方。' },
  unknownHelp: { en: 'The original external effect needs reconciliation. Observe or cancel the original identity; this page will not replay submission.', zh: '原始外部效果需要核对。请读取或取消原始身份；此页面不会重放提交。' },
  cancelHelp: { en: 'Cancellation has been requested. A stopped state is shown only after the owner confirms the original process or job stopped.', zh: '已请求取消。只有执行方确认原进程或作业已停止，才会显示“已停止”。' },
  prepared: { en: 'Prepared, awaiting approval', zh: '已准备，等待批准' },
  preparation_failed: { en: 'Preparation incomplete; prepare a new attempt', zh: '准备未完成，请新建一次尝试' },
  running: { en: 'Running', zh: '运行中' }, queued: { en: 'Queued', zh: '排队中' },
  completed: { en: 'Execution completed', zh: '执行完成' }, failed: { en: 'Execution failed', zh: '执行失败' },
  cancel_requested: { en: 'Cancellation requested', zh: '已请求取消' }, stopped: { en: 'Stop confirmed', zh: '已确认停止' },
  unknown: { en: 'Needs reconciliation', zh: '需要核对' },
};

export type RemoteAttempt = {
  id: string; clusterId: string; host: string; scheduler: 'ssh' | 'slurm'; directory: string; digest: string;
  samples: number; repetitions: number; useState: string;
  state: 'prepared' | 'preparation_failed' | 'running' | 'queued' | 'completed' | 'failed' | 'cancel_requested' | 'stopped' | 'unknown';
  logs: { stdout: string; stderr: string }; outputs: { path: string; sha256: string; reference: string }[];
  error?: string; exitCode?: number; jobId?: number; collected: boolean; account?: string; partition?: string;
};
type RemoteState = { available: boolean; error?: string; attempts: RemoteAttempt[];
  probe?: { clusterId: string; endpoint?: string; host: string; platform: string; python: string; cluster?: string } };

export function RemoteExecution({ active, clusters, selectedClusterId, onManage }: {
  active: boolean; clusters: Cluster[]; selectedClusterId: string | null; onManage(): void;
}) {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const [state, setState] = useState<RemoteState | null>(null), [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [clusterId, setClusterId] = useState(selectedClusterId ?? ''), [opened, setOpened] = useState('');
  const [samples, setSamples] = useState('10000'), [repetitions, setRepetitions] = useState('1');
  const [uncertainSubmission, setUncertainSubmission] = useState('');
  const pending = useRef(false), form = useRef<HTMLFormElement>(null), attemptBody = useRef<HTMLDivElement>(null);
  const cluster = clusters.find(item => item.id === clusterId) ?? clusters.find(item => item.id === selectedClusterId) ?? clusters[0];
  const attempt = state?.attempts.find(item => item.id === opened) ?? state?.attempts[0];
  useEffect(() => { if (attemptBody.current) attemptBody.current.scrollTop = 0; }, [attempt?.id]);
  const probe = state?.probe?.clusterId === cluster?.id && (!state?.probe?.endpoint || state.probe.endpoint === cluster?.host) ? state.probe : null;
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true; setLoading(true); setError('');
    try { setState(await api.get<RemoteState>('/api/remote')); setUncertainSubmission(''); }
    catch (cause) { setError(String(cause)); }
    finally { pending.current = false; setLoading(false); }
  }, [api]);
  useEffect(() => { if (active) void refresh(); }, [active, refresh]);
  useAppObject({ id: 'compute-remote-execution', kind: 'remote-execution', label: t('title'),
    state: { active, loading, busy, selectedClusterId: cluster?.id ?? null, available: state?.available ?? null,
      probe, attempts: state?.attempts ?? null } });

  async function update(operation: string, value: Record<string, unknown>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.post<RemoteState>('/api/remote', { operation, ...value });
      if (operation === 'prepare') setOpened(result.attempts.find(item => !state?.attempts.some(previous => previous.id === item.id))?.id ?? '');
      setState(result); setUncertainSubmission('');
    } catch (cause) {
      setError(String(cause));
      if (operation === 'submit') {
        setUncertainSubmission(String(value.id));
        // A read reconciles a lost reply without replaying a submission.
        try { setState(await api.get<RemoteState>('/api/remote')); } catch { /* Retain the previous evidence and explicit uncertainty. */ }
      }
    } finally { pending.current = false; setBusy(false); }
  }
  async function download(output: RemoteAttempt['outputs'][number]) {
    if (pending.current || !attempt) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const artifact = await api.post<{ filename: string; sha256: string; base64: string }>('/api/remote', { operation: 'artifact', id: attempt.id, digest: output.sha256 });
      downloadFile(artifact.filename, Uint8Array.from(atob(artifact.base64), character => character.charCodeAt(0)), 'application/octet-stream');
    } catch (cause) { setError(String(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  function prepare() {
    if (cluster && form.current?.reportValidity()) void update('prepare', { clusterId: cluster.id, samples: Number(samples), repetitions: Number(repetitions) });
  }
  const disabled = loading || busy || !state?.available;
  const facts: MetadataItem[] = attempt ? [
    { id: 'id', label: t('id'), value: attempt.id, format: 'code' },
    { id: 'host', label: t('host'), value: attempt.host, format: 'code' },
    { id: 'scheduler', label: t('scheduler'), value: attempt.scheduler === 'ssh' ? 'SSH' : 'Slurm / SSH' },
    { id: 'samples', label: t('samples'), value: attempt.samples },
    { id: 'repetitions', label: t('repetitions'), value: attempt.repetitions },
    { id: 'digest', label: t('digest'), value: attempt.digest, format: 'code' },
    { id: 'directory', label: t('directory'), value: attempt.directory, format: 'code' },
    ...(attempt.scheduler === 'slurm' ? [
      { id: 'resources', label: t('resources'), value: t('resourceValue') },
      { id: 'account', label: t('account'), value: attempt.account || t('siteDefault') },
      { id: 'partition', label: t('partition'), value: attempt.partition || t('siteDefault') },
    ] : []),
    ...(attempt.jobId != null ? [{ id: 'job', label: t('job'), value: attempt.jobId, format: 'code' as const }] : []),
    ...(attempt.exitCode != null ? [{ id: 'exit', label: t('exit'), value: attempt.exitCode }] : []),
    ...(attempt.useState ? [{ id: 'use', label: t('use'), value: attempt.useState, format: 'code' as const }] : []),
  ] : [];
  const executionStarted = attempt && !['prepared', 'preparation_failed'].includes(attempt.state);
  const cancellable = attempt && ['running', 'queued', 'unknown'].includes(attempt.state);
  const collectable = attempt && ['completed', 'failed', 'stopped'].includes(attempt.state) && !attempt.collected;

  return <div className="compute-remote-root">
    <div className="compute-remote-actions"><IconButton label={t('refresh')} disabled={loading || busy} onClick={() => void refresh()}><Icon name="refresh" /></IconButton>
      {loading && state ? <span role="status">{t('loading')}</span> : null}{busy ? <span role="status">{t('busy')}</span> : null}</div>
    {error ? <div className="compute-recovery"><Feedback kind="error" variant="block">{t('requestFailed')} {error} {state ? t('retained') : ''}</Feedback></div> : null}
    {notice ? <p className="compute-status" role="status">{notice}</p> : null}
    {!state ? loading && <LoadingSkeleton label={t('loading')} className="compute-loading"><SkeletonText /></LoadingSkeleton> : !state.available ? <Feedback kind="warning" variant="block">{t('unavailable')} {state.error}</Feedback> : null}
    {!clusters.length ? <EmptyState className="compute-empty" icon={<EmptyIllustration kind="compute" size="compact" />} heading={<h2>{t('noClusters')}</h2>} description={t('noClustersHelp')} actions={<Button onClick={onManage}>{t('manage')}</Button>} /> : <>
      <ContentPane id="compute-remote-preparation" label={t('method')} as="section" surface="workspace" inset="compact" scroll="pane" header={<InspectorHeader title={t('method')} />}>
        <p className="compute-help">{t('methodHelp')}</p>
        <form ref={form} className="compute-remote-form" onSubmit={event => { event.preventDefault(); prepare(); }} onKeyDown={event => {
          if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement) || event.defaultPrevented
            || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          event.preventDefault(); if (!event.repeat && !disabled) prepare();
        }}>
          <Field label={t('cluster')}>{control => <Select {...control} label={t('cluster')} value={cluster?.id ?? ''} disabled={disabled}
            options={clusters.map(item => ({ value: item.id, label: item.name, hint: item.host }))} onChange={setClusterId} />}</Field>
          <Field label={t('samples')} description={t('samplesHelp')}>{control => <Input {...control} type="number" min={1000} max={10000000} step={1} required value={samples} disabled={disabled} onChange={event => setSamples(event.target.value)} />}</Field>
          <Field label={t('repetitions')} description={t('repetitionsHelp')}>{control => <Input {...control} type="number" min={1} max={100000} step={1} required value={repetitions} disabled={disabled} onChange={event => setRepetitions(event.target.value)} />}</Field>
          <div className="compute-report-actions"><Button disabled={disabled || !cluster} onClick={() => cluster && void update('probe', { clusterId: cluster.id })}>{t('probe')}</Button>
            <Button variant="primary" disabled={disabled || !cluster} onClick={prepare}>{t('prepare')}</Button></div>
        </form>
        <p className="compute-help">{t('connectionHelp')}</p>
        {cluster?.scheduler === 'slurm' || !cluster?.scheduler ? <MetadataList items={[
          { id: 'resources', label: t('resources'), value: t('resourceValue') },
          { id: 'account', label: t('account'), value: cluster?.account || t('siteDefault') },
          { id: 'partition', label: t('partition'), value: cluster?.partition || t('siteDefault') },
        ]} /> : null}
        {probe ? <div className="compute-remote-probe"><Badge tone="success">{t('connected')}</Badge><MetadataList items={[
          { id: 'host', label: t('host'), value: probe.host, format: 'code' }, { id: 'platform', label: t('platform'), value: probe.platform },
          { id: 'python', label: t('python'), value: probe.python }, ...(probe.cluster ? [{ id: 'cluster', label: 'Slurm', value: probe.cluster }] : []),
        ]} /></div> : <p className="compute-help">{t('connectionUnknown')}</p>}
      </ContentPane>
      {attempt ? <Split storageKey="pero.compute.remote-width" collapseBelow={contentLayout.collapseBelow} className="compute-split">
        <SplitPane id="compute-remote-attempts" size={contentLayout.listSize} min={contentLayout.listMin} as="section" className="compute-list" aria-label={t('attempts')}>
          <ContentPane id="compute-remote-attempt-list" label={t('attempts')} as="div" surface="list" inset="none" scroll="pane"><ul>{state?.attempts.map(item => <li key={item.id}>
            <ListRow title={item.id} meta={`${item.host} · ${t(item.state)}`} current={item.id === attempt.id} onOpen={() => setOpened(item.id)} /></li>)}</ul></ContentPane>
        </SplitPane>
        <SplitPane id="compute-remote-attempt-detail" min={contentLayout.inspectorMin} as="section" className="compute-detail">
          <ContentPane id="compute-remote-attempt" label={attempt.id} as="div" bodyRef={attemptBody} surface="reading" inset="compact" scroll="pane"
            header={<InspectorHeader title={attempt.id} status={<Badge tone={attempt.state === 'failed' || attempt.state === 'preparation_failed' ? 'error' : attempt.state === 'unknown' ? 'warning' : 'neutral'}>{t(attempt.state)}</Badge>} actions={<div className="compute-report-actions">
              {attempt.state === 'prepared' && uncertainSubmission !== attempt.id ? <Button variant="primary" disabled={disabled} onClick={() => void update('submit', { id: attempt.id, digest: attempt.digest })}>{t('approve')}</Button> : null}
              {executionStarted || uncertainSubmission === attempt.id ? <Button disabled={disabled} onClick={() => void update('observe', { id: attempt.id })}>{t('observe')}</Button> : null}
              {cancellable ? <Button disabled={disabled} onClick={() => void update('cancel', { id: attempt.id })}>{t('cancel')}</Button> : null}
              {collectable ? <Button variant="primary" disabled={disabled} onClick={() => void update('collect', { id: attempt.id })}>{t('collect')}</Button> : null}
            </div>} />}>
            {attempt.state === 'prepared' ? <p className="compute-help">{t('preparedHelp')}</p> : null}
            {attempt.error ? <Feedback kind="error" variant="block">{attempt.error}</Feedback> : null}
            {uncertainSubmission === attempt.id ? <Feedback kind="warning" variant="block">{t('submissionUnknown')}</Feedback> : null}
            {attempt.state === 'unknown' ? <Feedback kind="warning" variant="block">{t('unknownHelp')}</Feedback> : null}
            {attempt.state === 'cancel_requested' ? <Feedback kind="info" variant="block">{t('cancelHelp')}</Feedback> : null}
            <ContentSection id="compute-remote-inputs" title={t('inputs')}><MetadataList layout="stacked" items={facts} /></ContentSection>
            {executionStarted ? <ContentSection id="compute-remote-logs" title={t('logs')}>
              {attempt.logs.stdout || attempt.logs.stderr ? <>{attempt.logs.stdout ? <pre className="compute-remote-log" aria-label="stdout">{attempt.logs.stdout}</pre> : null}
                {attempt.logs.stderr ? <pre className="compute-remote-log" aria-label="stderr">{attempt.logs.stderr}</pre> : null}</> : <p className="compute-help">{t('noLogs')}</p>}
            </ContentSection> : null}
            {attempt.state !== 'preparation_failed' ? <ContentSection id="compute-remote-outputs" title={t('outputs')}>
              {!attempt.collected ? <p className="compute-help">{t('outputPending')}</p> : !attempt.outputs.length ? <p className="compute-help">{t('outputMissing')}</p> : <>
                <p className="compute-help">{t('outputHelp')}</p><ul className="compute-remote-outputs">{attempt.outputs.map(output => <li key={output.reference}>
                  <MetadataList layout="stacked" items={[{ id: 'path', label: 'Path', value: output.path, format: 'code' },
                    { id: 'sha', label: 'SHA-256', value: output.sha256, format: 'code' }, { id: 'reference', label: 'Reference', value: output.reference, format: 'code' }]} />
                  <div className="compute-report-actions"><Button disabled={disabled} onClick={() => void download(output)}>{t('download')}</Button>
                  <Button onClick={() => void navigator.clipboard.writeText(output.reference).then(() => setNotice(t('copied')), () => setNotice(t('copyFailed')))}>{t('copy')}</Button></div>
                </li>)}</ul></>}
            </ContentSection> : null}
          </ContentPane>
        </SplitPane>
      </Split> : null}
    </>}
  </div>;
}
