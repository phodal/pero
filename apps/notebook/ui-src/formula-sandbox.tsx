import { useState } from 'react';
import { Button, Disclosure, Feedback, Field, Input, NativeSelect, Textarea } from '@pero/app-sdk/ui';
import { formulaHelp, inspectFormulaSandbox, type FormulaInspection } from '@pero/notebook/formula-inspection';
import type { NamedWorksheet } from '@pero/notebook/worksheet';

export interface FormulaSandboxProps {
  worksheets: readonly NamedWorksheet[];
  onSnapshot(title: string, snapshot: unknown, rows?: string[][]): boolean | void;
}
const examples = [
  ['Logic / 逻辑', '=IF(2>1,"yes","no")'],
  ['Sum / 求和', '=SUM(1,2,3)'],
  ['Lookup / 查找', '=XLOOKUP(2,{1,2,3},{10,20,30})'],
  ['Sequence / 序列', '=REVERSECOMPLEMENT("ATGCRY")'],
  ['Error / 错误', '=1/0'],
] as const;

export function FormulaSandboxPanel({ worksheets, onSnapshot }: FormulaSandboxProps) {
  const [name, setName] = useState(worksheets[0]?.name ?? ''), [address, setAddress] = useState('A1');
  const [source, setSource] = useState('=SUM(1,2,3)'), [error, setError] = useState('');
  const [result, setResult] = useState<{ inspection: FormulaInspection; signature: string } | null>(null);
  const signature = JSON.stringify([worksheets, name, address, source]);
  const current = result?.signature === signature ? result.inspection : null;
  const calculate = () => {
    setError(''); setResult(null);
    try { setResult({ inspection: inspectFormulaSandbox(worksheets, name, address, source), signature }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <div className="notebook-science-panel">
    <h3>Formula workbench / 公式工作台</h3>
    <p className="notebook-note">Uses the Notebook calculation engine and current worksheet values. The selected cell is replaced only in this preview, so referencing it creates a circular reference. Worksheets are never edited. / 使用当前工作表数据试算，仅在预览中替换所选单元格，不修改工作表。</p>
    {!worksheets.length && <Feedback kind="info">Add a worksheet to the note to choose a calculation context. / 请先在笔记中添加工作表。</Feedback>}
    <div className="notebook-science-fields">
      <Field label="Worksheet / 工作表">{control => <NativeSelect {...control} value={name} onChange={event => setName(event.target.value)}>{worksheets.map(sheet => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}</NativeSelect>}</Field>
      <Field label="Virtual cell / 虚拟单元格">{control => <Input {...control} value={address} onChange={event => setAddress(event.target.value.toUpperCase())} />}</Field>
      <Field label="Examples / 示例">{control => <NativeSelect {...control} value="" onChange={event => { if (event.target.value) setSource(event.target.value); }}><option value="">Choose / 选择</option>{examples.map(([label, formula]) => <option key={formula} value={formula}>{label}</option>)}</NativeSelect>}</Field>
    </div>
    <Field label="Expression / 表达式">{control => <Textarea {...control} rows={3} maxLength={8192} value={source} spellCheck={false} onChange={event => setSource(event.target.value)} />}</Field>
    <div className="notebook-science-actions"><Button disabled={!worksheets.length} onClick={calculate}>Evaluate / 计算</Button><Button disabled={!current} onClick={() => {
      if (current) onSnapshot('Formula workbench / 公式工作台', { method: 'pero-formula-workbench-v1', worksheet: name, virtualCell: address, worksheets, ...current }, [['Worksheet', name], ['Virtual cell', address], ['Expression', source], ['Type', current.type], ['Value', String(current.value)]]);
    }}>Insert snapshot / 插入快照</Button></div>
    {error && <Feedback kind="error">{error}</Feedback>}
    {result && !current && <Feedback kind="info">Inputs changed. Evaluate again before inserting. / 输入已变更，请重新计算。</Feedback>}
    {current && <>
      <Feedback kind={current.type === 'error' ? 'error' : 'success'}>{current.type}: {String(current.value)}</Feedback>
      <h4>Observed dependencies / 实际读取</h4>
      <pre className="notebook-science-json">{JSON.stringify(current.dependencies, null, 2)}</pre>
      <Disclosure summary="Engine tokens / 引擎词元"><pre className="notebook-science-json">{JSON.stringify(current.syntax.tokens, null, 2)}</pre>{current.syntax.error && <Feedback kind="error">{current.syntax.error}</Feedback>}</Disclosure>
      <Disclosure summary="Lexical structure (not AST) / 词法结构（非 AST）">
        <p className="notebook-note">The engine evaluates with embedded parser actions and does not expose an AST. This view groups its original tokens by delimiters only; it does not describe operator precedence or execution order. / 引擎不生成 AST，此处仅展示词元的括号分组，不代表运算优先级或执行顺序。</p>
        <pre className="notebook-science-json">{JSON.stringify(current.syntax.structure, null, 2)}</pre>
      </Disclosure>
    </>}
    <Disclosure summary="Supported menu and scientific functions / 支持的菜单与科研函数">
      <p className="notebook-note">This is a curated, tested menu, not a claim of complete Excel compatibility. / 此列表不是完整 Excel 兼容性声明。</p>
      <dl>{Object.entries(formulaHelp).map(([key, entry]) => <div key={key}><dt>{entry.syntax}</dt><dd>{entry.description}</dd></div>)}</dl>
    </Disclosure>
  </div>;
}
