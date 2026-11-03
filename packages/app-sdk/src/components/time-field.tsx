// Upstream attribution and license: packages/app-sdk/NOTICE.md.
import React from 'react';
import { DateInput, DateSegment, I18nProvider, Label, TimeField as AriaTimeField } from 'react-aria-components';
import { Time } from '@internationalized/date';
import { ensureUiStyles } from './ui-styles';

export type TimeFieldProps = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  locale: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

/** A local clock time, without a date or timezone conversion. Values use HH:mm. */
export function TimeField({ value, onChange, label, locale, id, name, disabled, required, className }: TimeFieldProps) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  const time = match ? new Time(Number(match[1]), Number(match[2])) : null;
  return <I18nProvider locale={locale}>
    <AriaTimeField id={id} name={name} className={['pero-ui-time-field', className].filter(Boolean).join(' ')}
      value={time} onChange={next => onChange(next ? `${String(next.hour).padStart(2, '0')}:${String(next.minute).padStart(2, '0')}` : '')}
      hourCycle={24} granularity="minute" shouldForceLeadingZeros isDisabled={disabled} isRequired={required} validationBehavior="native">
      <Label>{label}</Label>
      <DateInput className="pero-ui-time-input" ref={node => { if (node) ensureUiStyles(node.ownerDocument); }}>
        {segment => <DateSegment segment={segment} className="pero-ui-time-segment" />}
      </DateInput>
    </AriaTimeField>
  </I18nProvider>;
}
