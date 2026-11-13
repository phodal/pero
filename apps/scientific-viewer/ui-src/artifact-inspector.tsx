import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, ChatMarkdown, ContentIcon, Feedback, Icon, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
import type { ArtifactRelationRole, SessionArtifact, SessionArtifactVersion } from '../../../protocol/generated/host';
import type { ArtifactTarget } from '../../../protocol/artifact-browser';
import { ArtifactDocument } from './artifact-document';
import { checkpointCompanions, type ArtifactBrowserContext } from './artifact-browser-model';
import { exportArtifactReproduction, provenanceGaps, readArtifactEnvironment, readArtifactProvenance, type ArtifactEnvironmentObservation, type ArtifactProvenance, type ArtifactSelection } from './artifact-provenance';
import './artifact-inspector.css';

type EvidenceFile = { artifact: SessionArtifact; version: SessionArtifactVersion; role: ArtifactRelationRole };
const tabs = [
  { id: 'code', icon: 'code', label: ['代码', 'Code'], roles: ['code', 'input'] },
  { id: 'logs', icon: 'history', label: ['执行日志', 'Execution log'], roles: ['run_record', 'execution_log'] },
  { id: 'messages', icon: 'chat', label: ['消息', 'Messages'], roles: [] },
  { id: 'environment', icon: 'settings', label: ['环境', 'Environment'], roles: ['environment'] },
  { id: 'review', icon: 'shield', label: ['复核', 'Review'], roles: ['review'] },
] as const;

export function ArtifactInspector({ context, selected, zh, preview, open }: {
  context: ArtifactBrowserContext; selected: { artifact: SessionArtifact; version: SessionArtifactVersion };
  zh: boolean; preview: React.ReactNode; open(target: ArtifactTarget): void;
}) {
  const [tab, setTab] = useState('preview');
  const files: EvidenceFile[] = [];
  for (const relation of selected.version.related ?? []) {
    const artifact = context.artifacts.find(item => item.id === relation.artifact_id);
    const version = artifact?.versions.find(entry => entry.version === relation.version);
    if (artifact && version) files.push({ artifact, version, role: relation.role });
  }
  for (const companion of checkpointCompanions(context, selected)) {
    if (companion.version.source.kind !== 'research') continue;
    const slot = companion.version.source.provenance.slot.split('-')[0];
    const role = ({ log: 'execution_log', evidence: 'review', literature: 'input' } as const)[slot as 'log' | 'evidence' | 'literature'];
    if (role && !files.some(file => file.artifact.id === companion.artifact.id && file.version.version === companion.version.version)) {
      files.push({ ...companion, role });
    }
  }
  const sections = tabs.map(section => ({
    ...section, files: files.filter(file => (section.roles as readonly ArtifactRelationRole[]).includes(file.role)),
  })).filter(section => section.files.length || (section.id === 'messages' && context.source_message));
  if (context.inline) return <>{preview}</>;
  const visible = sections.some(section => section.id === tab) ? tab : 'preview';
  return <Tabs className="artifact-inspector" value={visible} onValueChange={setTab}>
    <ProvenanceSummary key={`${selected.artifact.id}/${selected.version.version}`} threadId={context.thread_id} selected={selected} files={files} zh={zh} />
    {sections.length > 0 && <TabsList className="artifact-inspector-tabs" variant="navigation" aria-label={zh ? '产物检查器' : 'Artifact inspector'}>
      <TabsTrigger value="preview"><Icon name="eye" size={14} />{zh ? '预览' : 'Preview'}</TabsTrigger>
      {sections.map(section => <TabsTrigger key={section.id} value={section.id}><Icon name={section.icon} size={14} />{section.label[zh ? 0 : 1]}</TabsTrigger>)}
    </TabsList>}
    <TabsContent className="artifact-inspector-body" forceMount value="preview">{preview}</TabsContent>
    {sections.map(section => <TabsContent key={section.id} className="artifact-inspector-body" value={section.id}>
      {section.id === 'messages'
        ? <div className="artifact-inspector-message"><ChatMarkdown><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']}
          components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{context.source_message}</ReactMarkdown></ChatMarkdown></div>
        : <EvidenceFiles files={section.files} threadId={context.thread_id} zh={zh} open={open} />}
    </TabsContent>)}
  </Tabs>;
}

function ProvenanceSummary({ threadId, selected, files, zh }: {
  threadId: string; selected: ArtifactSelection; files: EvidenceFile[]; zh: boolean;
}) {
  const [receipt, setReceipt] = useState<ArtifactProvenance | null>(null), [loading, setLoading] = useState(true);
  const [environment, setEnvironment] = useState<ArtifactEnvironmentObservation>();
  const [error, setError] = useState(''), [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false), [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    Promise.all([readArtifactProvenance(threadId, selected, files), readArtifactEnvironment(threadId, files)]).then(([value, observed]) => {
      if (active) { setReceipt(value); setEnvironment(observed); setLoading(false); }
    }, reason => {
      if (active) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); }
    });
    return () => { active = false; };
  }, [threadId, selected.artifact.id, selected.version.version, attempt]);
  const download = async () => {
    setExporting(true); setExportError('');
    try {
      const bytes = await exportArtifactReproduction(threadId, selected, files);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `artifact-${encodeURIComponent(selected.artifact.id)}-v${selected.version.version}-reproduction.zip`;
      anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setExportError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setExporting(false); }
  };
  const outcome = receipt?.outcome;
  const status = loading ? (zh ? '读取执行记录…' : 'Reading execution receipt…')
    : error && !receipt ? (zh ? '执行记录不可用' : 'Execution receipt unavailable')
    : outcome === 'succeeded' ? (zh ? '记录的执行：成功' : 'Recorded execution: succeeded')
    : outcome === 'failed' ? (zh ? '记录的执行：失败' : 'Recorded execution: failed')
    : outcome === 'cancelled' ? (zh ? '记录的执行：已取消' : 'Recorded execution: cancelled')
    : (zh ? '未观察执行' : 'Execution not observed');
  const labels: Record<string, string> = { 'execution receipt': '执行记录', 'command and arguments': '命令与参数', code: '代码', 'input files': '输入文件', 'environment observation': '环境观察', 'execution log': '执行日志', 'interpreter observation': '解释器观察', 'dependency inventory': '依赖清单' };
  const gaps = provenanceGaps(receipt, files, environment);
  return <section className="artifact-provenance" aria-label={zh ? '产物溯源' : 'Artifact provenance'}>
    <div className="artifact-provenance-row">
      <span className="artifact-provenance-status" data-outcome={loading ? 'loading' : outcome ?? 'unknown'} role="status">{status}</span>
      <Button variant="ghost" disabled={exporting || loading} onClick={download}>
        <Icon name="export" size={14} />{exporting ? (zh ? '正在导出…' : 'Exporting…') : (zh ? '导出复现材料' : 'Export reproduction')}
      </Button>
    </div>
    {!loading && <>
      {receipt?.invocation && <code className="artifact-provenance-command">{JSON.stringify([receipt.invocation.command, ...receipt.invocation.args])}</code>}
      {environment?.interpreter && <p>{environment.interpreter}{environment.dependencies !== undefined && (zh ? ` · 已观察 ${environment.dependencies} 个已安装包` : ` · ${environment.dependencies} installed distributions observed`)}</p>}
      {gaps.length > 0 && <p>{zh ? '未观察：' : 'Not observed: '}{gaps.map(value => zh ? labels[value] : value).join(zh ? '、' : ', ')}{zh ? '。' : '.'}</p>}
      <p>{zh ? '执行记录不代表科学结论已通过复核。' : 'An execution receipt does not establish scientific acceptance.'}</p>
    </>}
    {error && <Feedback kind="error">{error} <Button variant="link" onClick={() => retry(value => value + 1)}>{zh ? '重试' : 'Retry'}</Button></Feedback>}
    {exportError && <Feedback kind="error">{exportError} <Button variant="link" disabled={exporting} onClick={download}>{zh ? '重试导出' : 'Retry export'}</Button></Feedback>}
  </section>;
}

function EvidenceFiles({ files, threadId, zh, open }: {
  files: EvidenceFile[]; threadId: string; zh: boolean; open(target: ArtifactTarget): void;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const first = files.findIndex(file => file.role === 'code' || file.role === 'execution_log');
  const chosen = index ?? Math.max(0, first);
  const file = files[chosen];
  if (!file) return null;
  const locator = { threadId, artifactId: file.artifact.id, version: file.version.version };
  return <>
    <div className="artifact-evidence-files">
      <div className="artifact-evidence-list">
        {files.map(({ artifact, version, role }, at) => <Button
          key={`${artifact.id}/${version.version}/${at}`} variant="ghost"
          aria-pressed={at === chosen}
          title={version.filename ?? artifact.title}
          onClick={() => setIndex(at)}>
          <ContentIcon source={{ path: version.filename ?? artifact.title }} />
          <span>{version.filename ?? artifact.title}</span><span className="artifact-evidence-version">v{version.version}</span>
          {role === 'input' && <span className="artifact-evidence-version">{zh ? '输入' : 'Input'}</span>}
        </Button>)}
      </div>
      <Button variant="ghost" aria-label={zh ? '打开关联产物' : 'Open linked artifact'} title={zh ? '打开关联产物' : 'Open linked artifact'}
        onClick={() => open({ thread_id: threadId, artifact_id: locator.artifactId, version: locator.version })}>
        <Icon name="external-link" size={14} />
      </Button>
    </div>
    <ArtifactDocument key={`${locator.artifactId}/${locator.version}`} locator={locator} />
  </>;
}
