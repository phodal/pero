import { useEffect, useState } from 'react';
import { Button, Feedback, Field, NativeSelect } from '@pero/app-sdk/ui';
import paths from './source-registry.json';

type Source = { path: string; state: 'ready' | 'missing' | 'unavailable'; text?: string; sha256?: string; bytes?: number; reason?: string };
type Evidence = { schemaVersion: 1; sha256: string; sources: Source[]; dependencies: { owner: string; name: string; declared: string; installed: string | null }[] };
type EvidenceState = { status: 'loading' } | { status: 'unavailable' | 'missing'; message: string } | { status: 'ready'; evidence: Evidence };

/** One boundary validates this bounded, build-packaged evidence, never a user path. */
export async function loadSourceEvidence(signal?: AbortSignal): Promise<EvidenceState> {
  const response = await fetch('./source-evidence.json', { signal, cache: 'no-cache' });
  if (response.status === 404) return { status: 'missing', message: 'Source evidence was not packaged with this installation. / 此安装未包含来源证据。' };
  if (!response.ok) throw new Error('Source evidence is unavailable. / 来源证据暂不可用。');
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error('Source evidence exceeds the display limit.');
  const value = JSON.parse(text) as Evidence;
  const hash = (item: unknown) => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item);
  if (value.schemaVersion !== 1 || !hash(value.sha256) || !Array.isArray(value.sources) || value.sources.length !== paths.length
    || value.sources.some((item, index) => item.path !== paths[index] || !['ready', 'missing', 'unavailable'].includes(item.state)
      || (item.state === 'ready' && (typeof item.text !== 'string' || new TextEncoder().encode(item.text).length > 65536 || !hash(item.sha256) || item.bytes !== new TextEncoder().encode(item.text).length)))
    || !Array.isArray(value.dependencies) || value.dependencies.length > 100 || value.dependencies.some(item => !item || !['owner', 'name', 'declared'].every(key => typeof item[key as 'name'] === 'string') || !(item.installed === null || typeof item.installed === 'string')))
    throw new Error('Invalid packaged source evidence.');
  return { status: 'ready', evidence: value };
}
export function NotebookSourceDiagnostics({ initialPath = paths[0] }: { initialPath?: string }) {
  const [path, setPath] = useState(initialPath), [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<EvidenceState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController(); setState({ status: 'loading' });
    loadSourceEvidence(controller.signal).then(value => { if (!controller.signal.aborted) setState(value); }, () => {
      if (!controller.signal.aborted) setState({ status: 'unavailable', message: 'Source evidence could not be loaded. Retry or rebuild this installation. / 无法加载来源证据，请重试或重新构建。' });
    });
    return () => controller.abort();
  }, [attempt]);
  const source = state.status === 'ready' ? state.evidence.sources.find(item => item.path === path) : undefined;
  return <section aria-label="Installed source diagnostics / 安装来源诊断">
    <p className="notebook-note">Read-only Pero-owned source captured at build time. Content is inert text, never executed. This bounded registry excludes private and third-party source; it is not a file browser. / 构建时保存的只读 Pero 源码，不执行文本，不包含私有或第三方源码。</p>
    <Field label="Packaged source / 打包源码">{control => <NativeSelect {...control} value={path} onChange={event => setPath(event.target.value)}>{paths.map(value => <option key={value}>{value}</option>)}</NativeSelect>}</Field>
    {state.status === 'loading' && <p role="status">Loading installed source evidence… / 正在加载安装来源证据…</p>}
    {(state.status === 'missing' || state.status === 'unavailable') && <><Feedback kind="warning">{state.message}</Feedback><Button onClick={() => setAttempt(value => value + 1)}>Retry source evidence / 重试来源证据</Button></>}
    {state.status === 'ready' && <>
      <p>Evidence build SHA-256: <code>{state.evidence.sha256}</code></p>
      <p className="notebook-note">Digest identifies these packaged sources and dependency records, not a signed release or proof of execution. Installed versions were read from this build's dependency tree. / 摘要标识来源与依赖记录，不代表签名发布或执行验证。</p>
      {!source || source.state === 'missing' ? <Feedback kind="warning">Selected source is missing from this build. / 此构建缺少所选源码。</Feedback>
        : source.state === 'unavailable' ? <Feedback kind="warning">Selected source is unavailable: {source.reason}</Feedback>
        : <><p>Source SHA-256: <code>{source.sha256}</code> · {source.bytes} bytes</p><pre tabIndex={0} aria-label="Read-only source text / 只读源码" className="notebook-science-json">{source.text}</pre></>}
      <details><summary>Exact installed dependency provenance / 确切安装依赖来源</summary><ul>{state.evidence.dependencies.map(item => <li key={`${item.owner}:${item.name}`}>{item.owner} · {item.name}: {item.installed ?? 'unavailable / 未知'} (declared / 声明: {item.declared})</li>)}</ul></details>
    </>}
  </section>;
}
