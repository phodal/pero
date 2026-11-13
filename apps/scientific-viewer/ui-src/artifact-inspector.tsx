import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMarkdown, ContentIcon, Icon, IconButton, ListRow, Tabs, TabsContent, TabsList, TabsTrigger } from '@pero/app-sdk/ui';
import type { ArtifactRelationRole, SessionArtifact, SessionArtifactVersion } from '../../../protocol/generated/host';
import type { ArtifactTarget } from '../../../protocol/artifact-browser';
import { ArtifactDocument } from './artifact-document';
import { checkpointCompanions, type ArtifactBrowserContext } from './artifact-browser-model';
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
        {files.map(({ artifact, version, role }, at) => <ListRow
          key={`${artifact.id}/${version.version}/${at}`}
          current={at === chosen}
          icon={<ContentIcon source={{ path: version.filename ?? artifact.title }} />}
          title={version.filename ?? artifact.title}
          meta={<>v{version.version}{role === 'input' && <> · {zh ? '输入' : 'Input'}</>}</>}
          onOpen={() => setIndex(at)} />)}
      </div>
      <IconButton label={zh ? '打开关联产物' : 'Open linked artifact'}
        onClick={() => open({ thread_id: threadId, artifact_id: locator.artifactId, version: locator.version })}>
        <Icon name="external-link" size={14} />
      </IconButton>
    </div>
    <ArtifactDocument key={`${locator.artifactId}/${locator.version}`} locator={locator} />
  </>;
}
