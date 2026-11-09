import { useMemo, useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Disclosure, Feedback, Field, Input, NativeSelect } from '@pero/app-sdk/ui';
import { masterMixDefaults, masterMixExample, inspectCellEvidence, compareCellEvidence, type MasterMixInput } from '@pero/notebook/research-tools';
import type { NamedWorksheet } from '@pero/notebook/worksheet';
import type { FormulaSandboxProps } from './formula-sandbox';
import { inspectWorksheetCell } from '@pero/notebook/formula-inspection';
import { NotebookSourceDiagnostics } from './source-diagnostics';
import { scienceMessages } from './science-tools-shared';
import notebookManifest from '../package.json';
import coreManifest from '../../../packages/notebook/package.json';

const sources = [
  { area: 'Editing', owner: 'Tiptap / ProseMirror', contract: 'Structured blocks; Notebook owns saved revisions.', paths: ['apps/notebook/ui-src/editor-extensions.ts', 'apps/notebook/backend/store.py'], evidence: 'Declared dependency and owner implementation' },
  { area: 'Calculation', owner: 'fast-formula-parser + Pero', contract: 'Bounded local workbook evaluation; actual observed dependencies. No remote Excel service.', paths: ['packages/notebook/src/spreadsheet.ts', 'packages/notebook/src/formula-inspection.ts'], evidence: 'Calculation owner and observer contract' },
  { area: 'Source AST', owner: 'Pero', contract: 'Original bounded source tree, separate from evaluator execution and engine tokens.', paths: ['packages/notebook/src/formula-source-ast.ts', 'packages/notebook/src/formula-syntax.ts'], evidence: 'Source parser implementation' },
  { area: 'Exchange', owner: 'ExcelJS', contract: 'XLSX import/export; unsupported constructs are diagnosed.', paths: ['packages/notebook/src/workbook.ts'], evidence: 'Declared dependency and workbook adapter' },
  { area: 'Preparation', owner: 'Pero', contract: 'Recipe revisions and recorded actuals are distinct; QS estimates require additive volumes.', paths: ['packages/notebook/src/mixture.ts'], evidence: 'Preparation transition owner' },
  { area: 'Persistence', owner: 'Python / SQLite', contract: 'Local immutable revisions and recoverable drafts; not multi-user real-time collaboration.', paths: ['apps/notebook/backend/store.py', 'apps/notebook/backend/drafts.py'], evidence: 'Local storage implementation, not remote deployment evidence' },
];
const packages = Object.entries({ ...notebookManifest.dependencies, ...coreManifest.dependencies }).sort(([a], [b]) => a.localeCompare(b));
export function NotebookResearchTools({ worksheets, onSnapshot, onInsertExample }: FormulaSandboxProps & { onInsertExample?(example: ReturnType<typeof masterMixExample>): void }) {
  const { t } = useAppI18n(scienceMessages);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [input, setInput] = useState<MasterMixInput>({ ...masterMixDefaults }), [query, setQuery] = useState('');
  const [left, setLeft] = useState(worksheets[0]?.name ?? ''), [right, setRight] = useState(worksheets[0]?.name ?? '');
  const [leftCell, setLeftCell] = useState('A1'), [rightCell, setRightCell] = useState('B1'), [error, setError] = useState('');
  const [evidence, setEvidence] = useState<ReturnType<typeof inspectCellEvidence> | null>(null);
  const example = useMemo(() => { try { return { value: masterMixExample(input), error: '' }; } catch (cause) { return { value: null, error: String(cause) }; } }, [input]);
  const current = useMemo(() => { if (!evidence) return null; try { return inspectCellEvidence(worksheets, right, rightCell); } catch { return null; } }, [worksheets, evidence, right, rightCell]);
  const comparison = evidence && current ? compareCellEvidence(evidence, current) : null;
  const search = query.trim().toLowerCase();
  return <>
    <Disclosure summary={t('masterMixSummary')}>
      <p className="notebook-note">{t('masterMixNote')}</p>
      <div className="notebook-science-fields">{([
        ['reactions', 'reactionCount'], ['excessPercent', 'excessPercent'], ['volumePerReaction', 'volumePerReaction'], ['stockPerReaction', 'stockPerReaction'],
      ] as const).map(([key, label]) => <Field key={key} label={t(label)}>{control => <Input {...control} type="number" value={Number.isNaN(input[key]) ? '' : input[key]} onChange={event => setInput({ ...input, [key]: event.target.value === '' ? NaN : Number(event.target.value) })} />}</Field>)}</div>
      <div className="notebook-science-actions"><Button onClick={() => setInput({ ...input, reactions: 100 })}>{t('set100')}</Button><Button onClick={() => setInput({ ...masterMixDefaults })}>{t('resetExample')}</Button></div>
      {example.error && <Feedback kind="error">{example.error}</Feedback>}
      {example.value && <><p role="status">{t('plannedTotal')}: <strong>{example.value.total} µL</strong>; {t('qsDiluent')}: {example.value.diluent} µL</p>
        <pre className="notebook-science-json">{JSON.stringify(inspectWorksheetCell([example.value.worksheet], example.value.worksheet.name, 'C6'), null, 2)}</pre>
        {onInsertExample && <Button onClick={() => onInsertExample(example.value!)}>{t('insertWorksheet')}</Button>}
        <Button onClick={() => onSnapshot(t('masterMixTitle'), { method: 'pero-master-mix-example-v1', input, ...example.value })}>{t('insertExampleSnapshot')}</Button></>}
    </Disclosure>
    <Disclosure summary={t('compareEvidence')}>
      <p className="notebook-note">{t('compareNote')}</p>
      <div className="notebook-science-fields">{([['baselineSheet', left, setLeft], ['comparisonSheet', right, setRight]] as const).map(([label, value, set]) => <Field key={label} label={t(label)}>{control => <NativeSelect {...control} value={value} onChange={event => set(event.target.value)}>{worksheets.map(sheet => <option key={sheet.name}>{sheet.name}</option>)}</NativeSelect>}</Field>)}
        <Field label={t('baselineCell')}>{control => <Input {...control} value={leftCell} onChange={event => setLeftCell(event.target.value.toUpperCase())} />}</Field>
        <Field label={t('comparisonCell')}>{control => <Input {...control} value={rightCell} onChange={event => setRightCell(event.target.value.toUpperCase())} />}</Field></div>
      <Button disabled={!worksheets.length} onClick={() => { try { setEvidence(inspectCellEvidence(worksheets, left, leftCell)); setError(''); } catch (cause) { setError(String(cause)); } }}>{t('pinBaseline')}</Button>
      {error && <Feedback kind="error">{error}</Feedback>}
      {evidence && !current && <Feedback kind="warning">{t('invalidComparison')}</Feedback>}
      {comparison && <><dl>{Object.entries(comparison).filter(([key]) => key !== 'limitation').map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value ? t('sameValue') : t('differentValue')}</dd></div>)}</dl>
        <pre className="notebook-science-json">{JSON.stringify({ baseline: { ...evidence, inputs: undefined }, comparison: { ...current, inputs: undefined } }, null, 2)}</pre>
        <Button onClick={() => onSnapshot(t('comparisonTitle'), { method: 'pero-formula-evidence-comparison-v1', baseline: evidence, current, comparison })}>{t('insertComparison')}</Button></>}
    </Disclosure>
    <Disclosure summary={t('dependenciesSummary')}>
      <Field label={t('searchSources')}>{control => <Input {...control} value={query} onChange={event => setQuery(event.target.value)} />}</Field>
      <p className="notebook-note">{t('dependencyNote')}</p>
      {sources.filter(item => JSON.stringify(item).toLowerCase().includes(search)).map(item => <Disclosure key={item.area} summary={`${item.area}: ${item.owner}`}><p>{item.contract}</p><small>{item.evidence}</small><ul>{item.paths.map(path => <li key={path}><Button onClick={() => setSourcePath(path)}>{t('viewSource', { path })}</Button> <a href={`https://github.com/phodal/pero/blob/codex/notebook-blocks/${path}`} target="_blank" rel="noreferrer">{path}</a></li>)}</ul></Disclosure>)}
      {sourcePath && <><Button onClick={() => setSourcePath(null)}>{t('closeSource')}</Button><NotebookSourceDiagnostics key={sourcePath} initialPath={sourcePath} /></>}
      <ul>{packages.filter(([name]) => name.toLowerCase().includes(search)).map(([name, version]) => <li key={name}>{name}: {version}</li>)}</ul>
      {!sources.some(item => JSON.stringify(item).toLowerCase().includes(search)) && !packages.some(([name]) => name.toLowerCase().includes(search)) && <p>{t('noSources')}</p>}
    </Disclosure>
  </>;
}
