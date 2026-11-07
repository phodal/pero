import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppContext } from '@pero/app-sdk';
import { Button, ContentIcon, Feedback, Icon, Popover } from '@pero/app-sdk/ui';
import type { ArtifactRelationRole, SessionArtifact, SessionArtifactVersion } from '../../../protocol/generated/host';
import type { ArtifactTarget } from '../../../protocol/artifact-browser';
import { admitArtifactBrowser, artifactTarget, artifactVersion, checkpointCompanions, selectedArtifact, type ArtifactBrowserContext } from './artifact-browser-model';
import { ArtifactDocument } from './artifact-document';
import { ArtifactInspector } from './artifact-inspector';
import { composeBrowserArtifact, selectBrowserArtifact } from './artifact-browser-bridge';
import { artifactContext } from './artifact-source';
import { ArtifactThumbnail, artifactSize, artifactType } from './artifact-thumbnail';
import './artifact-browser.css';

const relationLabels: Record<ArtifactRelationRole, [string, string]> = {
  input: ['输入', 'Input'], code: ['代码', 'Code'], execution_log: ['执行日志', 'Execution log'],
  environment: ['环境', 'Environment'], review: ['复核材料', 'Review material'],
  run_record: ['运行记录', 'Run record'],
};

/** The parent owns catalog, selection and the persisted view. This entry admits its snapshot once. */
export function ArtifactBrowser({ threadId }: { threadId: string }) {
  const { locale } = useAppContext(), zh = locale === 'zh-CN';
  const [context, setContext] = useState<ArtifactBrowserContext | null>(null), [error, setError] = useState('');
  const [quickLookRequested, setQuickLook] = useState(false);
  const quickLook = quickLookRequested || context?.inline === true;
  const items = useRef(new Map<string, HTMLElement>()), grid = useRef<HTMLDivElement>(null);
  const browserScroll = useRef<HTMLDivElement>(null), savedScroll = useRef(0), restoreFocus = useRef(false);
  const quickReturn = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!threadId) { setError('Choose a conversation to browse its artifacts'); return; }
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'pero:app:context' || event.data.context?.artifactBrowser == null) return;
      try { setContext(admitArtifactBrowser(event.data.context.artifactBrowser, threadId)); setError(''); }
      catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [threadId]);
  useEffect(() => { setQuickLook(false); }, [context?.view]);
  useEffect(() => {
    if (context?.preview_request === undefined) return;
    savedScroll.current = browserScroll.current?.scrollTop ?? 0;
    setQuickLook(true);
  }, [context?.preview_request]);
  useLayoutEffect(() => {
    if (quickLook) quickReturn.current?.focus({ preventScroll: true });
    if (!quickLook && restoreFocus.current) {
      if (browserScroll.current) browserScroll.current.scrollTop = savedScroll.current;
      const selected = context?.selected?.artifact_id;
      if (selected) items.current.get(selected)?.focus({ preventScroll: true });
      restoreFocus.current = false;
    }
    if (!quickLook && context?.selected) {
      items.current.get(context.selected.artifact_id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [quickLook, context?.view, context?.selected?.artifact_id, context?.selected?.version]);
  const selected = context ? selectedArtifact(context) : undefined;
  const companions = context && selected ? checkpointCompanions(context, selected) : [];
  const select = (target: ArtifactTarget) => selectBrowserArtifact(target);
  const preview = (target: ArtifactTarget) => { savedScroll.current = browserScroll.current?.scrollTop ?? 0; select(target); setQuickLook(true); };
  const closePreview = () => { restoreFocus.current = true; setQuickLook(false); };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape' && quickLook && !context?.inline) { event.preventDefault(); closePreview(); return; }
    if (!context || (event.target as HTMLElement).closest('input,textarea,[contenteditable=true],.cm-editor')) return;
    if (quickLook) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-artifact-id]');
    if (!row) return;
    const index = Math.max(0, context.artifacts.findIndex(item => item.id === row.dataset.artifactId));
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault(); preview(artifactTarget(context.artifacts[index], context.selected)); return;
    }
    const columns = context.view === 'icons' && grid.current
      ? getComputedStyle(grid.current).gridTemplateColumns.trim().split(/\s+/).length : 1;
    const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns } as Record<string, number>)[event.key];
    if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? context.artifacts.length - 1 : Math.max(0, Math.min(context.artifacts.length - 1, index + delta));
    const next = context.artifacts[nextIndex];
    if (next) { select(artifactTarget(next, context.selected)); items.current.get(next.id)?.focus(); }
  };
  const versionFor = (item: SessionArtifact) => item.id === context?.selected?.artifact_id && selected ? selected.version : artifactVersion(item);
  const tile = (item: SessionArtifact, index: number, film = false) => {
    const version = versionFor(item), target = artifactTarget(item, context?.selected);
    const chosen = context?.selected?.artifact_id === item.id;
    return <Button variant="unstyled" key={`${item.id}/${version.version}`} type="button" role="option" aria-selected={chosen} data-artifact-id={item.id}
      aria-label={`${item.title}, ${artifactType(version)}, v${version.version}`} title={version.filename ?? item.title}
      className={`artifact-tile${chosen ? ' is-selected' : ''}${film ? ' artifact-film-tile' : ''}`}
      tabIndex={chosen || (!context?.selected && index === 0) ? 0 : -1}
      ref={node => { if (node) items.current.set(item.id, node); else items.current.delete(item.id); }}
      onClick={() => select(target)} onDoubleClick={() => preview(target)}>
      <ArtifactThumbnail artifact={item} version={version} />
      <span className="artifact-tile-name">{item.title}</span><span className="artifact-tile-version">v{version.version}</span>
    </Button>;
  };
  const shellDocumentBar = context?.shell_document_bar === true;
  const backToArtifacts = <Button ref={quickReturn} variant="ghost" aria-label={zh ? '返回产物' : 'Back to artifacts'} onClick={closePreview}><Icon name="arrow-left" size={14} /></Button>;
  const documentBar = (artifact: SessionArtifact, version: SessionArtifactVersion) => <div className="artifact-browser-document-bar">
    {quickLook && !context?.inline && backToArtifacts}
    <ContentIcon source={{ path: version.filename ?? artifact.title }} />
    <span className="artifact-browser-filename" title={version.filename ?? artifact.title}>{version.filename ?? artifact.title}</span>
    <div className="artifact-browser-versions">
      {!context?.inline && <Button variant="ghost" aria-label={zh ? '上一版本' : 'Previous version'} disabled={version.version <= 1}
        onClick={() => select({ thread_id: threadId, artifact_id: artifact.id, version: version.version - 1 })}><Icon name="chevron-left" size={14} /></Button>}
      <span>v{version.version} / {artifactVersion(artifact).version}</span>
      {!context?.inline && <Button variant="ghost" aria-label={zh ? '下一版本' : 'Next version'} disabled={version.version >= artifactVersion(artifact).version}
        onClick={() => select({ thread_id: threadId, artifact_id: artifact.id, version: version.version + 1 })}><Icon name="chevron-right" size={14} /></Button>}
    </div>
    <Popover label={zh ? '版本详情' : 'Version details'} triggerVariant="ghost" trigger={<Icon name="info" size={14} />} contentClassName="artifact-version-popover">
      {close => <><dl className="artifact-version-details" tabIndex={0}>
        <dt>{zh ? '快照' : 'Snapshot'}</dt><dd>{`v${version.version} · ${artifactType(version)} · ${version.bytes.toLocaleString(locale)} B`}</dd>
        <dt>{zh ? '保存时间' : 'Saved at'}</dt><dd>{version.created_at > 0 ? new Date(version.created_at * 1000).toLocaleString(locale) : (zh ? '未知' : 'Unknown')}</dd>
        <dt>{zh ? '来源' : 'Origin'}</dt>
        <dd>{version.source.kind === 'file' ? version.source.path : version.source.kind === 'research'
          ? `${zh ? '研究导出' : 'Research export'} · ${version.source.provenance.slot}`
          : (zh ? '会话内容' : 'Conversation content')}</dd>
        {version.source.kind === 'research' && <>
          <dt>{zh ? '研究检查点' : 'Checkpoint'}</dt><dd><code>{version.source.provenance.checkpoint_id}</code></dd>
        </>}
        <dt>SHA-256</dt><dd><code>{version.sha256}</code></dd>
      </dl>
      {!!version.related?.length && <section className="artifact-checkpoint-exports" aria-label={zh ? '关联文件' : 'Linked files'}>
        <h3>{zh ? '关联文件' : 'Linked files'}</h3>
        {version.related.map((link, index) => {
          const item = context?.artifacts.find(item => item.id === link.artifact_id);
          const snapshot = item?.versions.find(snapshot => snapshot.version === link.version);
          const name = item && snapshot ? snapshot.filename ?? item.title : (zh ? '文件不可用' : 'File unavailable');
          return <Button key={index} variant="ghost" disabled={!snapshot} onClick={() => {
            close();
            select({ thread_id: threadId, artifact_id: link.artifact_id, version: link.version });
          }}>{relationLabels[link.role][zh ? 0 : 1]} · {name} · v{link.version}</Button>;
        })}
      </section>}
      {companions.length > 0 && <section className="artifact-checkpoint-exports" aria-label={zh ? '同一检查点的交付物' : 'Exports from this checkpoint'}>
        <h3>{zh ? '同一检查点的交付物' : 'Exports from this checkpoint'}</h3>
        {companions.map(({ artifact: item, version: snapshot }) => <Button key={`${item.id}/${snapshot.version}`} variant="ghost" onClick={() => {
          close();
          select({ thread_id: threadId, artifact_id: item.id, version: snapshot.version });
        }}>{snapshot.filename ?? item.title} · v{snapshot.version}</Button>)}
      </section>}</>}
    </Popover>
  </div>;
  return <main className="artifact-browser" aria-label={zh ? '产物浏览器' : 'Artifact browser'} onKeyDown={onKeyDown}>
    {error ? <div className="artifact-empty"><Feedback kind="error">{error}</Feedback></div>
      : !context ? <div className="artifact-loading" role="status">{zh ? '正在载入产物…' : 'Loading artifacts…'}</div>
      : !context.artifacts.length ? <div className="artifact-empty"><p>{zh ? '还没有产物。使用上方的添加文件。' : 'No artifacts yet. Use Add file above.'}</p></div>
      : quickLook || context.view === 'gallery' ? <>
        {selected ? <><div className="artifact-browser-preview">
          {shellDocumentBar && quickLook ? <div className="artifact-browser-document-bar">{backToArtifacts}</div>
            : shellDocumentBar ? null : documentBar(selected.artifact, selected.version)}
          <ArtifactInspector key={`${threadId}/${selected.artifact.id}/${selected.version.version}`} context={context} selected={selected} zh={zh} open={select} preview={<ArtifactDocument
            locator={{ threadId, artifactId: selected.artifact.id, version: selected.version.version }}
            onDiscuss={(snapshot, selection) => composeBrowserArtifact({ thread_id: snapshot.locator.threadId, artifact_id: snapshot.locator.artifactId, version: snapshot.locator.version }, artifactContext(snapshot, selection, locale))} />} />
        </div></> : <div className="artifact-empty">{zh ? '选择产物以预览。' : 'Select an artifact to preview.'}</div>}
        {context.view === 'gallery' && !quickLook && <div className="artifact-gallery-strip" role="listbox" aria-label={zh ? '产物缩略图' : 'Artifact thumbnails'}>{context.artifacts.map((item, index) => tile(item, index, true))}</div>}
      </> : context.view === 'list' ? <div className="artifact-file-list" ref={browserScroll} role="listbox" aria-label={zh ? '产物列表' : 'Artifact list'}>
        <div className="artifact-list-heading" aria-hidden="true"><span>{zh ? '名称' : 'Name'}</span><span>{zh ? '类型' : 'Kind'}</span><span>{zh ? '大小' : 'Size'}</span><span>{zh ? '版本' : 'Version'}</span></div>
        {context.artifacts.map((item, index) => {
          const version = versionFor(item), target = artifactTarget(item, context.selected), chosen = context.selected?.artifact_id === item.id;
          return <Button variant="unstyled" type="button" key={item.id} role="option" aria-selected={chosen} data-artifact-id={item.id}
            className={`artifact-list-row${chosen ? ' is-selected' : ''}`} tabIndex={chosen || (!context.selected && index === 0) ? 0 : -1}
            ref={node => { if (node) items.current.set(item.id, node); else items.current.delete(item.id); }}
            onClick={() => select(target)} onDoubleClick={() => preview(target)}>
            <span className="artifact-list-name"><ContentIcon source={{ path: version.filename ?? item.title }} /><span>{item.title}</span></span>
            <span>{artifactType(version)}</span><span>{artifactSize(version.bytes)}</span><span>v{version.version}</span>
          </Button>;
        })}
      </div> : <div className="artifact-icon-grid" ref={node => { grid.current = node; browserScroll.current = node; }} role="listbox" aria-label={zh ? '产物图标' : 'Artifact icons'}>{context.artifacts.map((item, index) => tile(item, index))}</div>}
  </main>;
}
