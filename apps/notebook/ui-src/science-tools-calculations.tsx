import { useState } from 'react';
import { useAppI18n } from '@pero/app-sdk';
import { Button, Checkbox, Disclosure, Feedback, Field, Input, NativeSelect, Textarea } from '@pero/app-sdk/ui';
import { analyzeSequence, geneticCodes, type SequenceOptions } from '@pero/notebook/science-sequence';
import { estimateMeltingTemperature, type MeltingConditions } from '@pero/notebook/science-thermodynamics';
import { chemistryUnits, solveChemistry, type ChemistryInput, type ChemistryResult, type ChemistryTarget, type ChemistryVariable } from '@pero/notebook/science-chemistry';
import { scienceMessages, type SciencePanelProps } from './science-tools-shared';

export function SequencePanel({ onSnapshot }: SciencePanelProps) {
  const { t } = useAppI18n(scienceMessages);
  const [raw, setRaw] = useState(''), [options, setOptions] = useState<SequenceOptions>({ alphabet: 'DNA', code: 1, frame: 0, reverse: false, circular: false });
  const [conditions, setConditions] = useState<MeltingConditions>({ method: 'santalucia', oligoNm: 50, sodiumMm: 50, magnesiumMm: 1.5, dntpMm: 0.2 });
  const [result, setResult] = useState<{ analysis: ReturnType<typeof analyzeSequence>; melting: ReturnType<typeof estimateMeltingTemperature> | { unavailable: string }; signature: string } | null>(null);
  const [error, setError] = useState(''), [acknowledged, setAcknowledged] = useState(false);
  const signature = JSON.stringify([raw, options, conditions]), current = result?.signature === signature ? result : null;
  const calculate = () => {
    setAcknowledged(false); setResult(null); setError('');
    try {
      const analysis = analyzeSequence(raw, options);
      let melting: ReturnType<typeof estimateMeltingTemperature> | { unavailable: string };
      try { melting = estimateMeltingTemperature(analysis.sequence, conditions); }
      catch (cause) { melting = { unavailable: cause instanceof Error ? cause.message : String(cause) }; }
      setResult({ analysis, melting, signature });
    } catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)); }
  };
  return <div className="notebook-science-panel">
    <p className="notebook-note">{t('sequenceLimits')}</p>
    <Field label={t('rawSequence')}>{control => <Textarea {...control} value={raw} rows={4} maxLength={40_000} spellCheck={false} onChange={event => setRaw(event.target.value)} />}</Field>
    <div className="notebook-science-fields">
      <Field label={t('alphabet')}>{control => <NativeSelect {...control} value={options.alphabet} onChange={event => {
        const alphabet = event.target.value as SequenceOptions['alphabet']; setOptions({ ...options, alphabet });
        setConditions({ ...conditions, method: alphabet === 'RNA' ? 'xia' : 'santalucia', ...(alphabet === 'RNA' ? { magnesiumMm: 0, dntpMm: 0 } : {}) });
      }}><option>DNA</option><option>RNA</option></NativeSelect>}</Field>
      <Field label={t('code')}>{control => <NativeSelect {...control} value={options.code} onChange={event => setOptions({ ...options, code: Number(event.target.value) })}>{geneticCodes.map(code => <option value={code.id} key={code.id}>{code.id}. {code.name}</option>)}</NativeSelect>}</Field>
      <Field label={t('frame')}>{control => <NativeSelect {...control} value={options.frame} onChange={event => setOptions({ ...options, frame: Number(event.target.value) as 0 | 1 | 2 })}>{[0, 1, 2].map(frame => <option key={frame} value={frame}>{frame + 1}</option>)}</NativeSelect>}</Field>
    </div>
    <div className="notebook-science-actions">
      <label><Checkbox checked={options.reverse} onCheckedChange={value => setOptions({ ...options, reverse: value === true })} /> {t('reverse')}</label>
      <label><Checkbox checked={options.circular} onCheckedChange={value => setOptions({ ...options, circular: value === true })} /> {t('circular')}</label>
    </div>
    <div className="notebook-science-fields">
      <Field label={t('method')}>{control => <NativeSelect {...control} value={conditions.method} onChange={event => setConditions({ ...conditions, method: event.target.value as MeltingConditions['method'] })}>
        {options.alphabet === 'RNA' ? <option value="xia">Xia 1998 RNA</option> : <><option value="santalucia">SantaLucia 1998 / long DNA</option><option value="breslauer">Breslauer 1986 DNA</option></>}
      </NativeSelect>}</Field>
      {([['oligoNm', 'oligo'], ['sodiumMm', 'sodium'], ['magnesiumMm', 'magnesium'], ['dntpMm', 'dntp']] as const).map(([key, label]) => <Field key={key} label={t(label)}>{control => <Input {...control} type="number" min="0" step="any" value={Number.isFinite(conditions[key]) ? conditions[key] : ''} onChange={event => setConditions({ ...conditions, [key]: event.target.value === '' ? NaN : Number(event.target.value) })} />}</Field>)}
    </div>
    <Button onClick={calculate}>{t('calculate')}</Button>
    {error && <Feedback kind="error">{t('failure')} {error}</Feedback>}
    {current && <>
      {current.analysis.sequence.removed.length > 0 && <Feedback kind="warning">{t('removed')}<ul>{current.analysis.sequence.removed.map((item, index) => <li key={`${item.position}-${index}`}>{item.character} · {item.position}</li>)}</ul><label><Checkbox checked={acknowledged} onCheckedChange={value => setAcknowledged(value === true)} /> {t('acknowledgeRemoval')}</label></Feedback>}
      <div className="notebook-science-metrics">
        <strong>{current.analysis.length} nt</strong><strong>GC {current.analysis.gcPercent.toFixed(2)}%</strong><strong>ORF {current.analysis.orfs.length}</strong>
        <strong>Tm {'celsius' in current.melting ? `${current.melting.celsius.toFixed(2)} °C` : '—'}</strong>
      </div>
      {'unavailable' in current.melting && <Feedback kind="warning">Tm: {current.melting.unavailable}</Feedback>}
      <div className="notebook-science-result"><strong>{t('translation')}</strong><code>{current.analysis.translation || '∅'}</code><strong>{t('complement')}</strong><code>{current.analysis.complement}</code><strong>{t('reverseComplement')}</strong><code>{current.analysis.reverseComplement}</code></div>
      <Disclosure className="notebook-science-raw" summary={t('details')}>
        <p>{current.analysis.method}</p>
        <p>{current.analysis.limits}</p>
        {current.analysis.orfs.length > 0 && <ul>{current.analysis.orfs.map((orf, index) => <li key={`${orf.strand}-${orf.start}-${index}`}>{orf.strand} {orf.start}–{orf.end} · {orf.length} nt</li>)}</ul>}
      </Disclosure>
      <Button variant="primary" disabled={!!current.analysis.sequence.removed.length && !acknowledged} onClick={() => onSnapshot(t('sequence'), { ...current.analysis, meltingInput: conditions, melting: current.melting, removalAcknowledged: acknowledged })}>{t('insert')}</Button>
    </>}
  </div>;
}

const variables = Object.keys(chemistryUnits) as ChemistryVariable[];
function blankChemistry(): ChemistryInput {
  const fields = Object.fromEntries(variables.map(key => [key, { text: key === 'purity' ? '1' : '', unit: Object.keys(chemistryUnits[key])[0] }])) as ChemistryInput['fields'];
  return { target: 'amount', significantFigures: 3, fields };
}
export function ChemistryPanel({ onSnapshot }: SciencePanelProps) {
  const { t } = useAppI18n(scienceMessages);
  const [input, setInput] = useState(blankChemistry), [result, setResult] = useState<ChemistryResult | null>(null), [error, setError] = useState('');
  const update = (next: ChemistryInput) => { setInput(next); setResult(null); setError(''); };
  return <div className="notebook-science-panel">
    <p className="notebook-note">{t('chemistryLimits')}</p>
    <div className="notebook-science-fields">
      <Field label={t('target')}>{control => <NativeSelect {...control} value={input.target} onChange={event => update({ ...input, target: event.target.value as ChemistryTarget })}>{(['amount', 'mass', 'volume', 'equivalence'] as const).map(key => <option key={key} value={key}>{t(key)}</option>)}</NativeSelect>}</Field>
      <Field label={t('figures')}>{control => <Input {...control} type="number" min="1" max="12" value={input.significantFigures} onChange={event => update({ ...input, significantFigures: Number(event.target.value) })} />}</Field>
    </div>
    <div className="notebook-science-fields">
      {variables.map(key => <div key={key}>
        <Field label={t(key)}>{control => <Input {...control} value={input.fields[key].text} disabled={input.target === key} inputMode="decimal" onChange={event => update({ ...input, fields: { ...input.fields, [key]: { ...input.fields[key], text: event.target.value } } })} />}</Field>
        <Field label={`${t(key)} · ${t('unit')}`}>{control => <NativeSelect {...control} value={input.fields[key].unit} onChange={event => update({ ...input, fields: { ...input.fields, [key]: { ...input.fields[key], unit: event.target.value } } })}>{Object.keys(chemistryUnits[key]).map(unit => <option key={unit}>{unit}</option>)}</NativeSelect>}</Field>
      </div>)}
    </div>
    <Button onClick={() => { setResult(null); try { setResult(solveChemistry(input)); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }}>{t('calculate')}</Button>
    {error && <Feedback kind="error">{t('failure')} {error}</Feedback>}
    {result?.status === 'missing' && <Feedback kind="warning">{t('missing')}<ul>{result.alternatives.map(value => <li key={value}>{value}</li>)}</ul></Feedback>}
    {result?.status === 'solved' && <>
      <strong className="notebook-science-metrics">{t(input.target)} = {result.formatted} {result.unit}</strong>
      <Disclosure className="notebook-science-raw" summary={t('details')}>
        <p>{result.method}</p>
        {result.derivations.length > 0 && <ul>{result.derivations.map(line => <li key={line}>{line}</li>)}</ul>}
        <p>{result.limits}</p>
      </Disclosure>
      <Button variant="primary" onClick={() => onSnapshot(t('chemistry'), result)}>{t('insert')}</Button>
    </>}
  </div>;
}
