import './editor-inspector.css';
import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { downloadFile, useAppI18n } from '@pero/app-sdk';
import { Button, Field, Input, NativeSelect, Textarea } from '@pero/app-sdk/ui';
import { diagnosticLimits, inspectEditor, inspectPaste, notebookCapabilities, observeEditor, searchCapabilities, timingSummary, type DiagnosticText, type EditorTiming, type PasteDiagnostic } from './editor-diagnostics';

const messages = {
  title: { en: 'Editor diagnostics', zh: '编辑器诊断' }, close: { en: 'Close diagnostics', zh: '关闭诊断' },
  privacy: { en: 'Read-only local inspection. Capture runs only while this panel is open. Closing clears clipboard traces. HTML is displayed as text, never executed.', zh: '只读本地检查，仅在面板打开时采集。关闭后清除剪贴板记录。HTML 仅显示为文本，绝不执行。' },
  tab: { en: 'Inspect', zh: '检查内容' }, selection: { en: 'Selection and HTML', zh: '选区与 HTML' }, paste: { en: 'Paste trace and tray', zh: '粘贴记录与暂存区' },
  capabilities: { en: 'Capabilities and owners', zh: '能力与所有者' }, performance: { en: 'Performance', zh: '性能' },
  before: { en: 'Before selection', zh: '选区之前' }, selected: { en: 'Selected text', zh: '选中文本' }, after: { en: 'After selection', zh: '选区之后' },
  html: { en: 'Document HTML source', zh: '文档 HTML 源码' }, selectionHtml: { en: 'Selection HTML source', zh: '选区 HTML 源码' }, spans: { en: 'Selected formatting spans', zh: '选区格式片段' },
  bounded: { en: 'Display limited to {limit} characters. Full length: {length}.', zh: '仅显示前 {limit} 个字符，原始长度：{length}。' },
  tray: { en: 'Paste here to inspect without changing the notebook', zh: '在此粘贴以检查，不会修改笔记' }, emptyPaste: { en: 'No paste events captured yet.', zh: '尚未捕获粘贴事件。' },
  clear: { en: 'Clear captured events', zh: '清除已捕获事件' }, download: { en: 'Download diagnostic report', zh: '下载诊断报告' },
  exportNote: { en: 'The report includes selected notebook text and captured clipboard content. Review it before sharing.', zh: '报告包含笔记选区和捕获的剪贴板内容，分享前请检查。' },
  search: { en: 'Search capability names, owners and contracts', zh: '搜索能力、所有者与契约' }, category: { en: 'Capability type', zh: '能力类型' }, all: { en: 'All types', zh: '所有类型' },
  about: { en: 'This catalog is generated from the current Tiptap schema and Pero domain contracts. Registration is not external-owner availability or runtime acceptance. It contains no recovered private source.', zh: '目录由当前 Tiptap 数据结构和 Pero 领域契约生成。注册不代表外部所有者可用或运行验收通过。不包含恢复的私有源码。' },
  noMatches: { en: 'No matching capabilities.', zh: '没有匹配的能力。' },
  perfScope: { en: 'Observed view-update duration: beforeTransaction to transaction. Excludes state calculation, browser paint, backend latency and hidden/closed periods. These are measurements, not a benchmark score.', zh: '观察视图更新时间：beforeTransaction 至 transaction。不包含状态计算、浏览器绘制、后端延迟或面板关闭期间。仅为实测耗时，非性能评分。' },
  perfEmpty: { en: 'Edit or move the selection to collect measurements.', zh: '编辑内容或移动选区以采集耗时。' },
  samples: { en: 'Last {count} transactions; {changes} document changes.', zh: '最近 {count} 次事务；{changes} 次文档更改。' },
  counts: { en: '{nodes} document nodes; {size} ProseMirror positions.', zh: '{nodes} 个文档节点；{size} 个 ProseMirror 位置。' },
  reset: { en: 'Reset measurements', zh: '重置测量' },
} as const;

/** Non-modal so users can select, format and paste in the actual notebook while inspecting. */
export function NotebookEditorDiagnostics({ editor }: { editor: Editor }) {
  const { t } = useAppI18n(messages);
  const [open, setOpen] = useState(false);
  return <div className="notebook-editor-diagnostics">
    <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(value => !value)}>{t(open ? 'close' : 'title')}</Button>
    {open && <EditorInspectorPanel editor={editor} />}
  </div>;
}
function EditorInspectorPanel({ editor }: { editor: Editor }) {
  const { t, locale } = useAppI18n(messages);
  const [tab, setTab] = useState('selection'), [query, setQuery] = useState(''), [kind, setKind] = useState('');
  const [snapshot, setSnapshot] = useState(() => inspectEditor(editor));
  const [pastes, setPastes] = useState<PasteDiagnostic[]>([]), [timings, setTimings] = useState<EditorTiming[]>([]);
  const nextId = useRef(0), mounted = useRef(false);
  function capture(event: ClipboardEvent, target: PasteDiagnostic['target']) {
    const trace = inspectPaste(event, editor, target, ++nextId.current), before = editor.state.doc;
    if (target === 'tray') event.preventDefault();
    setPastes(events => [trace, ...events].slice(0, diagnosticLimits.events));
    // Observe the actual native paste dispatch outcome, not a simulated parser result.
    queueMicrotask(() => {
      if (!mounted.current || editor.isDestroyed) return;
      setPastes(events => events.map(item => item.id === trace.id ? { ...item, prevented: event.defaultPrevented, documentChanged: !before.eq(editor.state.doc) } : item));
    });
  }
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = observeEditor(editor, sample => {
      setSnapshot(inspectEditor(editor)); setTimings(samples => [...samples, sample].slice(-diagnosticLimits.timings));
    }, event => capture(event, 'editor'));
    return () => { mounted.current = false; unsubscribe(); };
  }, [editor]);
  const summary = timingSummary(timings), capabilities = searchCapabilities(notebookCapabilities(editor, locale), query, kind);
  function text(label: string, content: DiagnosticText) {
    return <details><summary>{label}</summary><pre>{content.text || '∅'}</pre>
      {content.truncated && <p>{t('bounded', { limit: diagnosticLimits.text, length: content.length })}</p>}</details>;
  }
  return <section className="notebook-science-panel" aria-label={t('title')}>
    <p>{t('privacy')}</p>
    <Field label={t('tab')}>{control => <NativeSelect {...control} value={tab} onChange={event => setTab(event.target.value)}>
      {(['selection', 'paste', 'capabilities', 'performance'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}
    </NativeSelect>}</Field>
    {tab === 'selection' && <>
      <output aria-label={t('selection')}>{JSON.stringify(snapshot.selection, null, 2)}</output>
      {text(t('before'), snapshot.before)}{text(t('selected'), snapshot.selected)}{text(t('after'), snapshot.after)}
      {text(t('selectionHtml'), snapshot.selectionHtml)}{text(t('html'), snapshot.html)}
      <details><summary>{t('spans')}</summary><pre>{JSON.stringify({ spans: snapshot.spans, truncated: snapshot.spansTruncated }, null, 2)}</pre></details>
    </>}
    {tab === 'paste' && <>
      <Textarea readOnly aria-label={t('tray')} placeholder={t('tray')} value="" onPaste={event => capture(event.nativeEvent, 'tray')} />
      <Button variant="ghost" disabled={!pastes.length} onClick={() => setPastes([])}>{t('clear')}</Button>
      {!pastes.length && <p>{t('emptyPaste')}</p>}
      {pastes.map(item => <details key={item.id}><summary>#{item.id} · {item.target} · {item.types.join(', ') || '∅'}</summary>
        <pre>{JSON.stringify({ ...item, text: undefined, html: undefined }, null, 2)}</pre>
        {text('text/plain', item.text)}{text('text/html', item.html)}</details>)}
    </>}
    {tab === 'capabilities' && <>
      <p>{t('about')}</p><Input aria-label={t('search')} value={query} onChange={event => setQuery(event.target.value)} />
      <Field label={t('category')}>{control => <NativeSelect {...control} value={kind} onChange={event => setKind(event.target.value)}>
        <option value="">{t('all')}</option>{['node', 'mark', 'extension', 'field', 'formula', 'procedure', 'intake'].map(value => <option key={value}>{value}</option>)}
      </NativeSelect>}</Field>
      {!capabilities.length && <p>{t('noMatches')}</p>}
      <ul>{capabilities.map(item => <li key={`${item.kind}:${item.name}`}><details><summary>{item.name} · {item.kind}</summary><p>{item.owner}</p><pre>{item.contract}</pre></details></li>)}</ul>
    </>}
    {tab === 'performance' && <>
      <p>{t('perfScope')}</p><p>{t('counts', { nodes: snapshot.nodeCount, size: snapshot.documentSize })}</p>
      {summary.count ? <><p>{t('samples', { count: summary.count, changes: summary.changes })}</p><output>Mean {summary.mean!.toFixed(3)} ms · P95 {summary.p95!.toFixed(3)} ms · Max {summary.max!.toFixed(3)} ms</output></> : <p>{t('perfEmpty')}</p>}
      <Button variant="ghost" disabled={!timings.length} onClick={() => setTimings([])}>{t('reset')}</Button>
    </>}
    <p>{t('exportNote')}</p><Button variant="ghost" onClick={() => downloadFile('Notebook-diagnostics.json', JSON.stringify({
      format: 'pero-notebook-diagnostics-v1', scope: 'local observations; bounded text; view-update timings only', limits: diagnosticLimits, snapshot, pastes, timings,
      capabilities: notebookCapabilities(editor, locale),
    }, null, 2), 'application/json')}>{t('download')}</Button>
  </section>;
}
