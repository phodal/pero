import { useEffect, useState } from 'react';
import { downloadFile, useAppApi, useAppI18n, type AppMessages } from '@pero/app-sdk';
import { Badge, Button, Card, ContentPane, Disclosure, EmptyState, Feedback, FilePicker, InspectorHeader, MetadataList } from '@pero/app-sdk/ui';

const messages: AppMessages = {
  import: { en: 'Import experiment report', zh: '导入实验报告' },
  choose: { en: 'Choose the JSON file produced by collect', zh: '选择 collect 生成的 JSON 文件' },
  empty: { en: 'Review a complete experiment batch', zh: '查看完整实验批次' },
  help: { en: 'Import a collected PyBaMM report to inspect all six experiments and their retained results.', zh: '导入 PyBaMM 汇总报告，查看全部六项实验及保留的原始结果。' },
  snapshot: { en: 'Snapshot observed at {time}. Refresh by collecting and importing a new report.', zh: '报告采集时间：{time}。重新采集并导入报告可更新观察。' },
  count: { en: '{count} / 6 reported consistent', zh: '报告记录 {count} / 6 项结果一致' },
  scope: { en: 'Consistency is the collector’s numerical check against the frozen reference. It does not establish experimental battery accuracy or independent-machine acceptance.', zh: '一致性表示采集器按固定参考执行的数值校验，不代表电池实验精度或独立机器验收通过。' },
  all: { en: 'Download complete report and logs', zh: '下载完整报告与日志' },
  result: { en: 'Download original result', zh: '下载原始结果' },
  trace: { en: 'Input and execution trace', zh: '输入与执行追溯' },
  record: { en: 'Download Run record and logs', zh: '下载执行记录与日志' },
  copy: { en: 'Copy Task link', zh: '复制任务链接' },
  copied: { en: 'Task link copied.', zh: '任务链接已复制。' },
  copyFailed: { en: 'Clipboard unavailable; the Task ID remains shown below.', zh: '剪贴板不可用，可使用下方任务编号。' },
  method: { en: 'Method SHA-256', zh: '方法 SHA-256' },
  elapsed: { en: 'Measured solve time: {time} s', zh: '实际求解耗时：{time} 秒' },
  retry: { en: 'Reload saved report', zh: '重新读取已保存报告' },
  retained: { en: 'The previous report is retained.', zh: '已保留上一份报告。' },
  succeeded: { en: 'Execution succeeded', zh: '执行成功' }, failed: { en: 'Failed', zh: '失败' },
  cancelled: { en: 'Cancelled', zh: '已取消' }, reconcile: { en: 'Needs reconciliation', zh: '待核对' },
  queued: { en: 'Queued', zh: '排队中' }, running: { en: 'Running', zh: '运行中' },
  cancel_requested: { en: 'Cancellation requested', zh: '已请求取消' }, draft: { en: 'Draft', zh: '草稿' },
  missing: { en: 'Missing', zh: '缺失' }, unavailable: { en: 'Unavailable', zh: '不可用' },
  consistent: { en: 'Reported consistent', zh: '报告校验一致' }, needs_review: { en: 'Needs review', zh: '需要复核' },
  not_checked: { en: 'Not checked', zh: '未校验' },
};

type Row = { experiment: string; task: string; run: string; worker: string; state: string; verification: string;
  reason: string; hostname: string; result_sha256: string; result_path: string; content: string | null; elapsed_s: number | null;
  c_rate: number; temperature_k: number; record: string };
type Report = { raw: string; batch: string; name: string; observed_at: string; method_sha256: string; consistent: number; rows: Row[] };

export function TaskReport() {
  const api = useAppApi(), { t } = useAppI18n(messages);
  const [report, setReport] = useState<Report | null>(null), [busy, setBusy] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  async function load() {
    setBusy(true); setError('');
    try { setReport(await api.get<Report | null>('/api/task-report')); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [api]);
  async function importReport(file: File) {
    setBusy(true); setError(''); setNotice('');
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('Report exceeds 4 MiB');
      setReport(await api.post<Report>('/api/task-report', JSON.parse(await file.text())));
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  return <ContentPane id="compute-task-report" label={t('empty')} as="section" surface="workspace" inset="compact" scroll="pane"
    toolbar={<div className="compute-report-actions"><FilePicker label={t('import')} emptyLabel={t('choose')} accept=".json,application/json" busy={busy} onFile={file => void importReport(file)} />
      <Button disabled={busy} onClick={() => void load()}>{t('retry')}</Button></div>}
    feedback={<>
      {error ? <Feedback kind="error">{error} {report ? t('retained') : ''}</Feedback> : null}
      {notice ? <p role="status">{notice}</p> : null}
    </>}
    header={report ? <InspectorHeader title={report.name} subtitle={t('count', { count: report.consistent })} status={<span>{t('snapshot', { time: report.observed_at })}</span>} actions={<Button onClick={() => downloadFile(`${report.batch}.json`, report.raw, 'application/json')}>{t('all')}</Button>} /> : undefined}>
    {!report ? !busy && <EmptyState heading={<h2>{t('empty')}</h2>} description={t('help')} /> : <>
      <p className="compute-help">{t('scope')}</p>
      <div className="compute-report-grid">{report.rows.map(row => <Card key={row.experiment} tone="blue" variant="soft" className="compute-report-row">
        <InspectorHeader title={`${row.c_rate} C · ${row.temperature_k} K`} status={<span className="compute-report-actions"><Badge>{t(row.state)}</Badge><Badge>{t(row.verification)}</Badge></span>} />
        <p>{row.hostname || row.worker || '—'}</p>{row.reason ? <p>{row.reason}</p> : null}
        {row.elapsed_s != null ? <p>{t('elapsed', { time: row.elapsed_s.toFixed(3) })}</p> : null}
        <div className="compute-report-actions">{row.content != null ? <Button onClick={() => downloadFile(`${row.experiment}.jsonl`, row.content!, 'application/x-ndjson')}>{t('result')}</Button> : null}
          <Button onClick={() => downloadFile(`${row.experiment}-run.json`, row.record, 'application/json')}>{t('record')}</Button>
          {row.task ? <Button onClick={() => void navigator.clipboard.writeText(`pero://tasks/${encodeURIComponent(row.task)}`).then(() => setNotice(t('copied')), () => setNotice(t('copyFailed')))}>{t('copy')}</Button> : null}</div>
        <Disclosure summary={t('trace')}><MetadataList layout="stacked" items={[
            { id: 'experiment', label: 'Experiment', value: row.experiment || '—', format: 'code' },
            { id: 'task', label: 'Task', value: row.task || '—', format: 'code' },
            { id: 'run', label: 'Run', value: row.run || '—', format: 'code' },
            { id: 'worker', label: 'Worker', value: row.worker || '—' },
            { id: 'method', label: t('method'), value: report.method_sha256 || '—', format: 'code' },
            { id: 'result', label: 'Result SHA-256', value: row.result_sha256 || '—', format: 'code' },
            { id: 'path', label: 'Path', value: row.result_path || '—', format: 'code' },
          ]} /></Disclosure>
      </Card>)}</div>
    </>}
  </ContentPane>;
}
