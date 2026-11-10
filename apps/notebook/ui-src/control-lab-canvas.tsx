import { useAppI18n } from '@pero/app-sdk';
import { Feedback, Field, Select } from '@pero/app-sdk/ui';
import type { NotebookDocument } from '@pero/notebook';
import { procedureParameterResolver } from '@pero/notebook/procedure-parameters';

const messages = {
  horizon: { en: 'Observation window (s)', zh: '观察时长（秒）' },
  samples: { en: 'Sample count', zh: '采样点数' },
  choose: { en: 'Choose a procedure parameter', zh: '选择流程参数' },
  hint: { en: 'PI controller analytic case. Select recorded or table-pinned parameters, then save the Notebook revision.', zh: 'PI 控制器解析算例。选择记录值或固定表格参数，然后保存笔记修订。' },
  invalid: { en: 'Select a current quantity in seconds and a whole-number sample count.', zh: '请选择有效的秒数和整数采样点数。' },
  stale: { en: 'The Notebook inputs changed. Review and save a new binding before creating an experiment.', zh: '笔记参数已变更。请核对并保存新的绑定后再创建实验。' },
} as const;

type Field = 'horizon' | 'samples';
type Pin = { procedureId: string; parameterId: string; version: number; value: string };
export type ControlMapping = Record<Field, string>;
const fields = ['horizon', 'samples'] as const;
const key = (pin: Pick<Pin, 'procedureId' | 'parameterId'>) => `${pin.procedureId}/${pin.parameterId}`;

export function controlParameterOptions(document: NotebookDocument) {
  const resolve = procedureParameterResolver(document);
  const choices: Record<Field, { label: string; pin: Pin }[]> = { horizon: [], samples: [] };
  for (const procedure of document.procedures ?? []) {
    for (const parameter of procedure.parameters ?? []) {
      if (parameter.source.kind === 'formula') continue;
      const result = resolve(procedure.id, parameter.id);
      if (result.status !== 'ok') continue;
      const value = result.value;
      const field = value.type === 'quantity' && value.unit === 's' ? 'horizon' :
        value.type === 'decimal' && Number.isSafeInteger(Number(value.value)) ? 'samples' : null;
      if (!field || (value.type !== 'decimal' && value.type !== 'quantity') || value.value.length > 128) continue;
      choices[field].push({
        label: `${procedure.title} / ${parameter.name} · ${value.value}${field === 'horizon' ? ' s' : ''}`,
        pin: { procedureId: procedure.id, parameterId: parameter.id, version: parameter.version, value: value.value },
      });
    }
  }
  return choices;
}

export function controlMapping(inputs?: Record<string, unknown>): ControlMapping {
  const selection = (field: Field) => {
    const pin = inputs?.[field] as Partial<Pin> | undefined;
    return typeof pin?.procedureId === 'string' && typeof pin.parameterId === 'string' ? key({ procedureId: pin.procedureId, parameterId: pin.parameterId }) : '';
  };
  return { horizon: selection('horizon'), samples: selection('samples') };
}

export function controlPins(choices: ReturnType<typeof controlParameterOptions>, mapping: ControlMapping) {
  const horizon = choices.horizon.find(item => key(item.pin) === mapping.horizon)?.pin;
  const samples = choices.samples.find(item => key(item.pin) === mapping.samples)?.pin;
  return horizon && samples ? { horizon, samples } : null;
}

export function sameControlPins(pins: ReturnType<typeof controlPins>, inputs?: Record<string, unknown>) {
  return !!pins && fields.every(field => {
    const saved = inputs?.[field] as Partial<Pin> | undefined;
    const current = pins[field];
    return saved?.procedureId === current.procedureId && saved.parameterId === current.parameterId &&
      saved.version === current.version && saved.value === current.value;
  });
}

export function ControlLabInputs({ choices, mapping, onChange }: {
  choices: ReturnType<typeof controlParameterOptions>; mapping: ControlMapping; onChange(value: ControlMapping): void;
}) {
  const { t } = useAppI18n(messages);
  return <div className="notebook-control-canvas-inputs">
    <p className="notebook-note">{t('hint')}</p>
    <div className="notebook-science-fields">
      {fields.map(field => <Field key={field} label={t(field)}>{control =>
        <Select {...control} label={t(field)} placeholder={t('choose')} value={mapping[field]}
          options={choices[field].map(({ label, pin }) => ({ label, value: key(pin) }))}
          onChange={value => onChange({ ...mapping, [field]: value })} />}
      </Field>)}
    </div>
  </div>;
}

export function ControlLabInputError({ stale }: { stale?: boolean }) {
  const { t } = useAppI18n(messages);
  return <Feedback kind="warning">{t(stale ? 'stale' : 'invalid')}</Feedback>;
}
