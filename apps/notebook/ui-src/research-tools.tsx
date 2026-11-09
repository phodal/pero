import { useMemo, useState } from 'react';
import { Button, Disclosure, Feedback, Field, Input, NativeSelect } from '@pero/app-sdk/ui';
import { masterMixDefaults, masterMixExample, inspectCellEvidence, compareCellEvidence, type MasterMixInput } from '@pero/notebook/research-tools';
import type { NamedWorksheet } from '@pero/notebook/worksheet';
import type { FormulaSandboxProps } from './formula-sandbox';
import { inspectWorksheetCell } from '@pero/notebook/formula-inspection';
import { NotebookSourceDiagnostics } from './source-diagnostics';
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
    <Disclosure summary="Master-mix worked example / 配液计算示例">
      <p className="notebook-note">Original planning example using the same worksheet and mixture owners as the notebook. No registered materials, measured quantities or physical preparation are implied. / 仅为计划算例，不代表登记材料、实测值或实际制备。</p>
      <div className="notebook-science-fields">{([
        ['reactions', 'Reaction count / 反应数'], ['excessPercent', 'Excess (%) / 余量'], ['volumePerReaction', 'Final µL per reaction / 每反应终体积'], ['stockPerReaction', 'Stock µL per reaction / 每反应原液'],
      ] as const).map(([key, label]) => <Field key={key} label={label}>{control => <Input {...control} type="number" value={Number.isNaN(input[key]) ? '' : input[key]} onChange={event => setInput({ ...input, [key]: event.target.value === '' ? NaN : Number(event.target.value) })} />}</Field>)}</div>
      <div className="notebook-science-actions"><Button onClick={() => setInput({ ...input, reactions: 100 })}>Set 100 reactions / 设为 100</Button><Button onClick={() => setInput({ ...masterMixDefaults })}>Reset example / 重置示例</Button></div>
      {example.error && <Feedback kind="error">{example.error}</Feedback>}
      {example.value && <><p role="status">Planned total / 计划总体积: <strong>{example.value.total} µL</strong>; QS diluent estimate / 补足估算: {example.value.diluent} µL</p>
        <pre className="notebook-science-json">{JSON.stringify(inspectWorksheetCell([example.value.worksheet], example.value.worksheet.name, 'C6'), null, 2)}</pre>
        {onInsertExample && <Button onClick={() => onInsertExample(example.value!)}>Insert editable worksheet and recipe / 插入可编辑工作表与配方</Button>}
        <Button onClick={() => onSnapshot('Master-mix planning example', { method: 'pero-master-mix-example-v1', input, ...example.value })}>Insert example snapshot / 插入示例快照</Button></>}
    </Disclosure>
    <Disclosure summary="Compare formula source evidence / 比较公式来源证据">
      <p className="notebook-note">Pin one current cell with its complete workbook, then compare another cell or later edits. Matching outputs do not prove independent validation. / 固定单元格及完整输入后比较，不将结果一致视为独立验证。</p>
      <div className="notebook-science-fields">{([['Baseline worksheet / 基准工作表', left, setLeft], ['Comparison worksheet / 比较工作表', right, setRight]] as const).map(([label, value, set]) => <Field key={label} label={label}>{control => <NativeSelect {...control} value={value} onChange={event => set(event.target.value)}>{worksheets.map(sheet => <option key={sheet.name}>{sheet.name}</option>)}</NativeSelect>}</Field>)}
        <Field label="Baseline cell / 基准单元格">{control => <Input {...control} value={leftCell} onChange={event => setLeftCell(event.target.value.toUpperCase())} />}</Field>
        <Field label="Comparison cell / 比较单元格">{control => <Input {...control} value={rightCell} onChange={event => setRightCell(event.target.value.toUpperCase())} />}</Field></div>
      <Button disabled={!worksheets.length} onClick={() => { try { setEvidence(inspectCellEvidence(worksheets, left, leftCell)); setError(''); } catch (cause) { setError(String(cause)); } }}>Pin baseline / 固定基准</Button>
      {error && <Feedback kind="error">{error}</Feedback>}
      {evidence && !current && <Feedback kind="warning">Choose a valid comparison cell. / 请选择有效比较单元格。</Feedback>}
      {comparison && <><dl>{Object.entries(comparison).filter(([key]) => key !== 'limitation').map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value ? 'Same / 一致' : 'Different / 不同'}</dd></div>)}</dl>
        <pre className="notebook-science-json">{JSON.stringify({ baseline: { ...evidence, inputs: undefined }, comparison: { ...current, inputs: undefined } }, null, 2)}</pre>
        <Button onClick={() => onSnapshot('Formula source comparison', { method: 'pero-formula-evidence-comparison-v1', baseline: evidence, current, comparison })}>Insert comparison snapshot / 插入比较快照</Button></>}
    </Disclosure>
    <Disclosure summary="Technical dependencies and source evidence / 技术依赖与来源证据">
      <Field label="Search Pero dependencies and sources / 搜索 Pero 依赖与来源">{control => <Input {...control} value={query} onChange={event => setQuery(event.target.value)} />}</Field>
      <p className="notebook-note">Versions below come from the current Pero package manifests, not an inferred private source-map inventory. Declaration does not prove runtime execution; source links follow the Notebook development branch and may differ from this installed build. / 版本来自 Pero 包声明，不代表运行验证；源码链接指向 Notebook 开发分支，可能与安装版本不同。</p>
      {sources.filter(item => JSON.stringify(item).toLowerCase().includes(search)).map(item => <Disclosure key={item.area} summary={`${item.area}: ${item.owner}`}><p>{item.contract}</p><small>{item.evidence}</small><ul>{item.paths.map(path => <li key={path}><Button onClick={() => setSourcePath(path)}>View installed source / 查看安装源码: {path}</Button> <a href={`https://github.com/phodal/pero/blob/codex/notebook-blocks/${path}`} target="_blank" rel="noreferrer">{path}</a></li>)}</ul></Disclosure>)}
      {sourcePath && <><Button onClick={() => setSourcePath(null)}>Close source / 关闭源码</Button><NotebookSourceDiagnostics key={sourcePath} initialPath={sourcePath} /></>}
      <ul>{packages.filter(([name]) => name.toLowerCase().includes(search)).map(([name, version]) => <li key={name}>{name}: {version}</li>)}</ul>
      {!sources.some(item => JSON.stringify(item).toLowerCase().includes(search)) && !packages.some(([name]) => name.toLowerCase().includes(search)) && <p>No matching Pero sources. / 无匹配来源。</p>}
    </Disclosure>
  </>;
}
