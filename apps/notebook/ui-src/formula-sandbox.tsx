import { useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Disclosure, Feedback, Field, Input, NativeSelect, Textarea } from '@pero/app-sdk/ui';
import { formulaHelp, inspectFormulaSandbox, type FormulaInspection } from '@pero/notebook/formula-inspection';
import type { NamedWorksheet } from '@pero/notebook/worksheet';
import { FormulaSourceTree } from './formula-source-tree';
import { NotebookResearchTools } from './research-tools';
import type { masterMixExample } from '@pero/notebook/research-tools';
import { scienceMessages } from './science-tools-shared';

export interface FormulaSandboxProps {
  worksheets: readonly NamedWorksheet[];
  onInsertExample?(example: ReturnType<typeof masterMixExample>): void;
  onSnapshot(title: string, snapshot: unknown, rows?: string[][]): boolean | void;
}
const exampleFormulas = [
  ['formulaLogic', '=IF(2>1,"yes","no")'],
  ['formulaSum', '=SUM(1,2,3)'],
  ['formulaLookup', '=XLOOKUP(2,{1,2,3},{10,20,30})'],
  ['formulaSequence', '=REVERSECOMPLEMENT("ATGCRY")'],
  ['formulaError', '=1/0'],
] as const;

export function FormulaSandboxPanel({ worksheets, onSnapshot, onInsertExample }: FormulaSandboxProps) {
  const { t } = useAppI18n(scienceMessages);
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
    <h3>{t('formula')}</h3>
    <NotebookResearchTools worksheets={worksheets} onSnapshot={onSnapshot} onInsertExample={onInsertExample} />
    <p className="notebook-note">{t('formulaNote')}</p>
    {!worksheets.length && <Feedback kind="info">{t('addWorksheet')}</Feedback>}
    <div className="notebook-science-fields">
      <Field label={t('worksheet')}>{control => <NativeSelect {...control} value={name} onChange={event => setName(event.target.value)}>{worksheets.map(sheet => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}</NativeSelect>}</Field>
      <Field label={t('virtualCell')}>{control => <Input {...control} value={address} onChange={event => setAddress(event.target.value.toUpperCase())} />}</Field>
      <Field label={t('examples')}>{control => <NativeSelect {...control} value="" onChange={event => { if (event.target.value) setSource(event.target.value); }}><option value="">{t('choose')}</option>{exampleFormulas.map(([label, formula]) => <option key={formula} value={formula}>{t(label)}</option>)}</NativeSelect>}</Field>
    </div>
    <Field label={t('expression')}>{control => <Textarea {...control} rows={3} maxLength={8192} value={source} spellCheck={false} onChange={event => setSource(event.target.value)} />}</Field>
    <div className="notebook-science-actions"><Button disabled={!worksheets.length} onClick={calculate}>{t('evaluate')}</Button><Button disabled={!current} onClick={() => {
      if (current) onSnapshot(t('formula'), { method: 'pero-formula-workbench-v1', worksheet: name, virtualCell: address, worksheets, ...current }, [[t('worksheet'), name], [t('virtualCell'), address], [t('expression'), source], [t('snapshotType'), current.type], [t('snapshotValue'), String(current.value)]]);
    }}>{t('insert')}</Button></div>
    {error && <Feedback kind="error">{error}</Feedback>}
    {result && !current && <Feedback kind="info">{t('inputsChanged')}</Feedback>}
    {current && <>
      <Feedback kind={current.type === 'error' ? 'error' : 'success'}>{current.type}: {String(current.value)}</Feedback>
      <h4>{t('observedDependencies')}</h4>
      <pre className="notebook-science-json">{JSON.stringify(current.dependencies, null, 2)}</pre>
      <Disclosure summary={t('engineTokens')}><pre className="notebook-science-json">{JSON.stringify(current.syntax.tokens, null, 2)}</pre>{current.syntax.error && <Feedback kind="error">{current.syntax.error}</Feedback>}</Disclosure>
      <FormulaSourceTree syntax={current.syntax} />
      <Disclosure summary={t('lexicalStructure')}>
        <p className="notebook-note">{t('lexicalNote')}</p>
        <pre className="notebook-science-json">{JSON.stringify(current.syntax.structure, null, 2)}</pre>
      </Disclosure>
    </>}
    <Disclosure summary={t('supportedFunctions')}>
      <p className="notebook-note">{t('curatedMenu')}</p>
      <dl>{Object.entries(formulaHelp).map(([key, entry]) => <div key={key}><dt>{entry.syntax}</dt><dd>{entry.description}</dd></div>)}</dl>
    </Disclosure>
  </div>;
}
